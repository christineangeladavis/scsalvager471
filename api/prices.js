// Vercel Serverless Function — community price reports backed by Upstash Redis
// Endpoint: /api/prices
//   GET  -> { [locationName]: { medianPrice, reportCount, lastReportedAt } }
//   POST { location, price } -> { ok, medianPrice, reportCount, lastReportedAt }
//
// Environment variables (auto-injected by the Vercel Marketplace Upstash Redis
// integration): UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN (and/or the
// KV_REST_API_URL / KV_REST_API_TOKEN aliases).
//
// Anti-troll design:
//   - Reports stored as a rolling window of the last MAX_REPORTS per location
//   - medianPrice is the median of stored reports — one spike is diluted out
//   - Price must be within [MIN_PRICE, MAX_PRICE]
//   - Location name capped at 100 chars

import { getRedis } from "./_lib/redis.js";
import { getSession } from "./_lib/session.js";

const MASTER_KEY = "cmat-prices:all";
const MAX_REPORTS_PER_LOCATION = 50;
const MIN_PRICE = 100;
const MAX_PRICE = 200000;

export function median(nums) {
  if (!nums.length) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export function buildPublicView(dataMap) {
  const result = {};
  for (const [name, entry] of Object.entries(dataMap || {})) {
    if (!entry || !Array.isArray(entry.reports) || !entry.reports.length) continue;
    const prices = entry.reports
      .map((r) => (r && typeof r.price === "number" ? r.price : null))
      .filter((p) => p !== null);
    if (!prices.length) continue;
    const timestamps = entry.reports.map((r) => (r && r.ts) || 0);
    result[name] = {
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
    const priceNum = Number(body.price);

    if (!location) {
      return res.status(400).json({ error: "Missing location" });
    }
    if (!Number.isFinite(priceNum)) {
      return res.status(400).json({ error: "Invalid price" });
    }
    if (priceNum < MIN_PRICE || priceNum > MAX_PRICE) {
      return res.status(400).json({
        error: `Price must be between ${MIN_PRICE.toLocaleString()} and ${MAX_PRICE.toLocaleString()} aUEC/SCU`,
      });
    }

    try {
      const data = (await redis.get(MASTER_KEY)) || {};
      const existing = data[location] || { location, reports: [] };
      const nextReports = [
        ...(Array.isArray(existing.reports) ? existing.reports : []),
        { price: Math.round(priceNum), ts: Date.now() },
      ].slice(-MAX_REPORTS_PER_LOCATION);

      data[location] = { location, reports: nextReports };
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
