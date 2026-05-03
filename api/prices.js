// Vercel Serverless Function — community price reports backed by Upstash Redis
// Endpoint: /api/prices
//   GET  -> { [material::locationName]: { medianPrice, reportCount, lastReportedAt } }
//   POST { material, location, price } -> { ok, medianPrice, reportCount, lastReportedAt }
//
// Latest-wins model: every POST overwrites the stored entry for that
// (material, location) so the most recent report becomes the single
// authoritative price. The response field is still `medianPrice` for
// client backward-compat, but with a single stored report it always
// equals the submitted value. GET continues to compute over the
// stored reports array, so old multi-report entries (from before the
// switch to latest-wins) still resolve correctly until they get
// replaced by a fresh report.
//
// Backward compatibility: legacy entries (stored with plain location keys, no
// "::" separator) are treated as Construction Material on read. New writes
// always go to prefixed keys. This means old CMAT reports remain visible
// until someone reports a fresh price on the same location, at which
// point the prefixed key takes over with the new latest-wins single entry.
//
// Environment variables (auto-injected by the Vercel Marketplace Upstash Redis
// integration): UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN (and/or the
// KV_REST_API_URL / KV_REST_API_TOKEN aliases).
//
// Validation:
//   - Price must be within [MIN_PRICE, MAX_PRICE]
//   - Location and material names capped at 100 chars

import { getRedis } from "./_lib/redis.js";
import { getSession } from "./_lib/session.js";

const MASTER_KEY = "cmat-prices:all";
const MAX_REPORTS_PER_LOCATION = 50;
const MIN_PRICE = 100;
const MAX_PRICE = 200000;
const DEFAULT_MATERIAL = "Construction Materials";
// Old name -> new name. We accept the old name on write (so stale clients
// don't error) and normalize it to the new name before keying. On read
// we merge old-keyed entries into the new key.
const MATERIAL_RENAMES = {
  "Recycle Material Composite": "Recycled Material Composite",
  // Renamed to match the in-game label ("CONSTRUCTION MATERIALS",
  // plural) shown on the Commodities / Trading Console screen.
  "Construction Material": "Construction Materials",
};
const ALLOWED_MATERIALS = new Set([
  "Construction Materials",
  "Recycled Material Composite",
  // Legacy aliases — accepted from stale clients and from old stored
  // reports, normalized to the new name before the storage key is built.
  "Construction Material",
  "Recycle Material Composite",
]);
const KEY_SEP = "::";

function canonicalMaterial(material) {
  return MATERIAL_RENAMES[material] || material;
}

function buildKey(material, location) {
  return `${canonicalMaterial(material)}${KEY_SEP}${location}`;
}

function normalizeLegacyKey(rawKey) {
  // If the stored key has no "::" separator it's a pre-material-namespace entry
  // and represents a Construction Material report (the only material the app
  // tracked at the time those entries were written).
  if (typeof rawKey !== "string") return null;
  if (!rawKey.includes(KEY_SEP)) return buildKey(DEFAULT_MATERIAL, rawKey);
  // Already material-namespaced — but might be under a renamed material.
  // Rewrite the material half so old entries roll up under the new name.
  const idx = rawKey.indexOf(KEY_SEP);
  const material = rawKey.slice(0, idx);
  const location = rawKey.slice(idx + KEY_SEP.length);
  return buildKey(material, location);
}

export function median(nums) {
  if (!nums.length) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export function buildPublicView(dataMap) {
  // Two storage keys can canonicalize to the same public key (e.g. an old
  // "Recycle Material Composite::HUR-L1" entry and a new "Recycled Material
  // Composite::HUR-L1" entry roll up to the same view). Merge their reports
  // first, then compute the median once.
  const merged = {};
  for (const [rawKey, entry] of Object.entries(dataMap || {})) {
    if (!entry || !Array.isArray(entry.reports) || !entry.reports.length) continue;
    const publicKey = normalizeLegacyKey(rawKey);
    if (!publicKey) continue;
    if (!merged[publicKey]) merged[publicKey] = [];
    merged[publicKey].push(...entry.reports);
  }
  const result = {};
  for (const [publicKey, reports] of Object.entries(merged)) {
    const prices = reports
      .map((r) => (r && typeof r.price === "number" ? r.price : null))
      .filter((p) => p !== null);
    if (!prices.length) continue;
    const timestamps = reports.map((r) => (r && r.ts) || 0);
    result[publicKey] = {
      medianPrice: Math.round(median(prices)),
      reportCount: prices.length,
      lastReportedAt: Math.max(...timestamps),
    };
  }
  return result;
}

export default async function handler(req, res) {
  // Check Upstash availability up front
  let redis;
  try {
    redis = getRedis();
  } catch (e) {
    console.error("Upstash init failed:", e.message);
    // For GET, silently return empty so the frontend falls back to baseline prices
    if (req.method === "GET") {
      return res.status(200).json({});
    }
    return res.status(503).json({ error: e.message });
  }

  if (req.method === "GET") {
    try {
      const raw = (await redis.get(MASTER_KEY)) || {};
      res.setHeader("cache-control", "public, max-age=30");
      return res.status(200).json(buildPublicView(raw));
    } catch (e) {
      console.error("GET /api/prices failed:", e && e.message ? e.message : e);
      return res.status(200).json({});
    }
  }

  if (req.method === "POST") {
    const session = await getSession(req, redis);
    if (!session) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { body = null; }
    }
    if (!body || typeof body !== "object") {
      return res.status(400).json({ error: "Invalid JSON" });
    }

    const rawLocation = typeof body.location === "string" ? body.location.trim() : "";
    const location = rawLocation.slice(0, 100);
    const rawMaterial = typeof body.material === "string" ? body.material.trim() : "";
    const material = rawMaterial.slice(0, 100) || DEFAULT_MATERIAL;
    const priceNum = Number(body.price);

    if (!location) {
      return res.status(400).json({ error: "Missing location" });
    }
    if (!ALLOWED_MATERIALS.has(material)) {
      return res.status(400).json({
        error: `Material must be one of: ${[...ALLOWED_MATERIALS].join(", ")}`,
      });
    }
    if (!Number.isFinite(priceNum)) {
      return res.status(400).json({ error: "Invalid price" });
    }
    if (priceNum < MIN_PRICE || priceNum > MAX_PRICE) {
      return res.status(400).json({
        error: `Price must be between ${MIN_PRICE.toLocaleString()} and ${MAX_PRICE.toLocaleString()} aUEC/SCU`,
      });
    }

    const canonical = canonicalMaterial(material);
    const storageKey = buildKey(material, location);

    try {
      const data = (await redis.get(MASTER_KEY)) || {};
      // Latest-wins: discard any prior reports for this
      // (material, location) and store only the new submission.
      // Subsequent GET calls see this single price as both the
      // medianPrice (single value → median is itself) and the
      // sole report. Legacy plain-keyed entries are NOT migrated
      // because the new prefixed write is now authoritative
      // for the public view.
      const ts = Date.now();
      const price = Math.round(priceNum);
      const nextReports = [{ price, ts }];

      data[storageKey] = { material: canonical, location, reports: nextReports };
      await redis.set(MASTER_KEY, data);

      return res.status(200).json({
        ok: true,
        medianPrice: price,
        reportCount: 1,
        lastReportedAt: ts,
      });
    } catch (e) {
      console.error("POST /api/prices failed:", e && e.message ? e.message : e);
      return res.status(500).json({
        error: "Storage write failed. " + (e && e.message ? e.message : "Unknown error."),
      });
    }
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Method not allowed" });
}
