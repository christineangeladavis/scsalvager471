// GET /api/admin/user-history?userId=<id>&days=30
//
// Admin-only. Returns one user's refinery jobs + sell orders within the
// last `days` days (default 30, max 365). Soft-deleted entries are
// filtered out — same view the user themselves sees.
//
// Response shape:
//   {
//     fetchedAt: <ms>,
//     userId,
//     username,
//     windowDays,
//     refineryJobs: [...],
//     sellOrders: [...]
//   }

import { getRedis } from "../_lib/redis.js";
import { getSession } from "../_lib/session.js";
import { isAdminSession } from "../_lib/admin.js";
import { getUserMeta } from "../_lib/userIndex.js";
import {
  ledgerKey,
  sanitizeRefineryJob,
  sanitizeSellOrder,
} from "../ledger.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  res.setHeader("cache-control", "private, no-store");

  let redis;
  try {
    redis = getRedis();
  } catch (e) {
    return res.status(503).json({ error: e.message });
  }

  const session = await getSession(req, redis);
  if (!session) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  if (!isAdminSession(session)) {
    return res.status(403).json({ error: "Admin access required" });
  }

  const userId = String(req.query?.userId || "").trim();
  if (!userId) {
    return res.status(400).json({ error: "userId required" });
  }

  const daysRaw = Number(req.query?.days);
  const windowDays = Math.max(
    1,
    Math.min(365, Number.isFinite(daysRaw) ? daysRaw : 30)
  );
  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;

  let stored;
  try {
    stored = await redis.get(ledgerKey(userId));
  } catch (e) {
    return res.status(500).json({ error: "Could not load ledger" });
  }

  const meta = await getUserMeta(redis, userId);
  const username = meta?.username || "Unknown";

  const refineryJobs = Array.isArray(stored?.refineryJobs)
    ? stored.refineryJobs
        .map(sanitizeRefineryJob)
        .filter(Boolean)
        .filter((j) => !j.deletedAt && j.submittedAt >= cutoff)
        .sort((a, b) => b.submittedAt - a.submittedAt)
    : [];

  const sellOrders = Array.isArray(stored?.sellOrders)
    ? stored.sellOrders
        .map(sanitizeSellOrder)
        .filter(Boolean)
        .filter((o) => !o.deletedAt && o.submittedAt >= cutoff)
        .sort((a, b) => b.submittedAt - a.submittedAt)
    : [];

  return res.status(200).json({
    fetchedAt: Date.now(),
    userId,
    username,
    windowDays,
    refineryJobs,
    sellOrders,
  });
}
