// Vercel Serverless Function — community price reports backed by Upstash Redis
// Endpoint: /api/prices
//   GET  -> { [material::locationName]: { medianPrice, reportCount, lastReportedAt } }
//   POST { material, location, price } -> { ok, medianPrice, reportCount, lastReportedAt }
//
// Backward compatibility: legacy entries (stored with plain location keys, no
// "::" separator) are treated as Construction Material on read. New writes
// always go to prefixed keys. This means old CMAT reports remain visible
// forever; any new CMAT report on the same location is stored at the prefixed
// key and accumulates fresh reports. The legacy entry is left in place
// untouched (lazy migration — could be cleaned up by a one-shot script later).
//
// Environment variables (auto-injected by the Vercel Marketplace Upstash Redis
// integration): UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN (and/or the
// KV_REST_API_URL / KV_REST_API_TOKEN aliases).
//
// Anti-troll design:
//   - Reports stored as a rolling window of the last MAX_REPORTS per (material,location)
//   - medianPrice is the median of stored reports — one spike is diluted out
//   - Price must be within [MIN_PRICE, MAX_PRICE]
//   - Location and material names capped at 100 chars

import { getRedis } from "./_lib/redis.js";
import { getSession } from "./_lib/session.js";

const MASTER_KEY = "cmat-prices:all";
const MAX_REPORTS_PER_LOCATION = 50;
const MIN_PRICE = 100;
const MAX_PRICE = 200000;
const DEFAULT_MATERIAL = "Construction Material";
// Old name -> new name. We accept the old name on write (so stale clients
// don't error) and normalize it to the new name before keying. On read
// we merge old-keyed entries into the new key.
const MATERIAL_RENAMES = {
  "Recycle Material Composite": "Recycled Material Composite",
};
const ALLOWED_MATERIALS = new Set([
  "Construction Material",
  "Recycled Material Composite",
  // Legacy alias — accepted from stale clients, normalized to the new
  // name before the storage key is built.
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
      // Backward compat: if writing CMAT and a legacy plain-keyed entry exists
      // for this location, seed the prefixed entry with its reports so the new
      // report extends history rather than restarting it.
      let existing = data[storageKey];
      if (!existing && canonical === DEFAULT_MATERIAL && data[location]) {
        existing = data[location];
      }
      // Backward compat: if this material was renamed, also try the old key
      // so the new entry inherits prior reports rather than starting empty.
      if (!existing) {
        for (const [oldName, newName] of Object.entries(MATERIAL_RENAMES)) {
          if (newName !== canonical) continue;
          const oldKey = `${oldName}${KEY_SEP}${location}`;
          if (data[oldKey]) { existing = data[oldKey]; break; }
        }
      }
      existing = existing || { material: canonical, location, reports: [] };

      const nextReports = [
        ...(Array.isArray(existing.reports) ? existing.reports : []),
        { price: Math.round(priceNum), ts: Date.now() },
      ].slice(-MAX_REPORTS_PER_LOCATION);

      data[storageKey] = { material: canonical, location, reports: nextReports };
      await redis.set(MASTER_KEY, data);

      const prices = nextReports.map((r) => r.price);
      return res.status(200).json({
        ok: true,
        medianPrice: Math.round(median(prices)),
        reportCount: prices.length,
        lastReportedAt: nextReports[nextReports.length - 1].ts,
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
