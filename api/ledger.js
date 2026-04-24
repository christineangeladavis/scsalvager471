// GET  /api/ledger         — returns { refineryJobs, sellOrders } for the logged-in user
// POST /api/ledger         — replaces the ledger with the request body (full snapshot)
// Returns 401 if not logged in.

import { getRedis } from "./_lib/redis.js";
import { getSession } from "./_lib/session.js";

const MAX_REFINERY_JOBS = 500;
const MAX_SELL_ORDERS = 500;

function ledgerKey(userId) {
  return `ledger:${userId}`;
}

function sanitizeRefineryJob(j) {
  if (!j || typeof j !== "object") return null;
  const out = {
    id: String(j.id || "").slice(0, 80),
    material: String(j.material || "").slice(0, 80),
    location: j.location ? String(j.location).slice(0, 80) : undefined,
    yield: Number(j.yield),
    cost: Number(j.cost),
    timeMinutes: Number(j.timeMinutes),
    submittedAt: Number(j.submittedAt),
    completesAt: Number(j.completesAt),
    pickedUpAt: j.pickedUpAt ? Number(j.pickedUpAt) : null,
  };
  if (!out.id || !out.material) return null;
  if (!Number.isFinite(out.yield) || !Number.isFinite(out.cost)) return null;
  if (!Number.isFinite(out.submittedAt) || !Number.isFinite(out.completesAt)) return null;
  if (out.pickedUpAt !== null && !Number.isFinite(out.pickedUpAt)) out.pickedUpAt = null;
  if (out.location === undefined) delete out.location;
  return out;
}

function sanitizeSellOrder(o) {
  if (!o || typeof o !== "object") return null;
  const out = {
    id: String(o.id || "").slice(0, 80),
    scu: Number(o.scu),
    location: String(o.location || "").slice(0, 120),
    aUEC: Number(o.aUEC),
    submittedAt: Number(o.submittedAt),
  };
  if (!out.id || !out.location) return null;
  if (!Number.isFinite(out.scu) || !Number.isFinite(out.aUEC)) return null;
  if (!Number.isFinite(out.submittedAt)) return null;
  return out;
}

export default async function handler(req, res) {
  let redis;
  try {
    redis = getRedis();
  } catch (e) {
    console.error("Ledger — Redis unavailable:", e.message);
    return res.status(503).json({ error: e.message });
  }

  const session = await getSession(req, redis);
  if (!session) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const key = ledgerKey(session.userId);
  res.setHeader("cache-control", "private, no-store");

  if (req.method === "GET") {
    try {
      const data = (await redis.get(key)) || { refineryJobs: [], sellOrders: [] };
      return res.status(200).json({
        refineryJobs: Array.isArray(data.refineryJobs) ? data.refineryJobs : [],
        sellOrders: Array.isArray(data.sellOrders) ? data.sellOrders : [],
      });
    } catch (e) {
      console.error("GET /api/ledger failed:", e && e.message ? e.message : e);
      return res.status(500).json({ error: "Could not load ledger" });
    }
  }

  if (req.method === "POST") {
    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        body = null;
      }
    }
    if (!body || typeof body !== "object") {
      return res.status(400).json({ error: "Invalid JSON" });
    }

    const refineryJobsRaw = Array.isArray(body.refineryJobs) ? body.refineryJobs : [];
    const sellOrdersRaw = Array.isArray(body.sellOrders) ? body.sellOrders : [];

    const refineryJobs = refineryJobsRaw
      .slice(-MAX_REFINERY_JOBS)
      .map(sanitizeRefineryJob)
      .filter(Boolean);
    const sellOrders = sellOrdersRaw.slice(-MAX_SELL_ORDERS).map(sanitizeSellOrder).filter(Boolean);

    try {
      await redis.set(key, { refineryJobs, sellOrders });
      return res.status(200).json({
        ok: true,
        counts: { refineryJobs: refineryJobs.length, sellOrders: sellOrders.length },
      });
    } catch (e) {
      console.error("POST /api/ledger failed:", e && e.message ? e.message : e);
      return res.status(500).json({ error: "Could not save ledger" });
    }
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Method not allowed" });
}
