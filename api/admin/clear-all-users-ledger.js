// POST /api/admin/clear-all-users-ledger
//
// Admin-only. Bulk version of clear-user-ledger — iterates every
// indexed user and soft-clears their entire ledger (refinery jobs
// + sell orders), cancelling in-flight QStash notification
// schedules along the way. Used as the patch-advance cleanup
// when a new SC release drops and we want every user's ledger to
// start the new cycle clean.
//
// Body must include `{ confirm: "CLEAR_ALL_USERS_LEDGERS" }`.
// The literal string is a server-side belt over the 2-step
// browser confirmation modal — a stray POST or replayed request
// can't accidentally wipe everyone.
//
// Soft-delete (set deletedAt on each entry) matches the per-entry
// Discard pattern. Admin Patch Exports still see the records in
// their audit-trail CSV. User's own ledger view filters them out.
//
// Response:
//   200 { ok: true, usersProcessed, jobsCleared, salesCleared, clearedAt, errors }
//   400 { error: "Missing or invalid confirmation" }
//   401 { error: "Not authenticated" }
//   403 { error: "Admin access required" }
//   503 { error: "Storage unavailable" }

import { getRedis } from "../_lib/redis.js";
import { getSession } from "../_lib/session.js";
import { isAdminSession } from "../_lib/admin.js";
import { listUserIds } from "../_lib/userIndex.js";
import { softClearLedger } from "../_lib/ledgerOps.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  res.setHeader("cache-control", "private, no-store");

  let redis;
  try {
    redis = getRedis();
  } catch {
    return res.status(503).json({ error: "Storage unavailable" });
  }

  const session = await getSession(req, redis);
  if (!session) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  if (!isAdminSession(session)) {
    return res.status(403).json({ error: "Admin access required" });
  }

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
  if (body.confirm !== "CLEAR_ALL_USERS_LEDGERS") {
    return res.status(400).json({ error: "Missing or invalid confirmation" });
  }

  const userIds = await listUserIds(redis);
  let totalJobs = 0;
  let totalSales = 0;
  let usersProcessed = 0;
  const errors = [];

  // Sequential to avoid hammering Redis. softClearLedger does a
  // GET + SET per user — fan-out parallelism risks blowing the
  // per-second cap on the Upstash plan.
  for (const userId of userIds) {
    try {
      const { jobsCleared, salesCleared } = await softClearLedger(redis, userId);
      totalJobs += jobsCleared;
      totalSales += salesCleared;
      usersProcessed += 1;
    } catch (e) {
      console.error(
        "clear-all-users-ledger: per-user clear failed:",
        userId,
        e && e.message ? e.message : e
      );
      errors.push({ userId, error: e && e.message ? e.message : String(e) });
    }
  }

  return res.status(200).json({
    ok: true,
    usersProcessed,
    totalUsers: userIds.length,
    jobsCleared: totalJobs,
    salesCleared: totalSales,
    clearedAt: Date.now(),
    errors,
  });
}
