// POST /api/admin/clear-user-ledger
//
// Admin-only. Soft-deletes entries in a target user's ledger
// (refinery jobs + sell orders) and cancels matching in-flight QStash
// notification schedules. Scope is selectable:
//
//   { scope: "all" }            — every entry (legacy behavior)
//   { scope: "patch", patchVersion: "4.7.2" }
//                                — entries whose submittedAt falls in
//                                  patchRange(version)'s [from, to)
//
// Body must include `{ userId, confirm: "CLEAR_USER_LEDGER", scope, ... }`.
// The literal-string confirmation is a server-side belt over the
// 2-step browser confirmation modal — a stray POST or replayed
// request can't accidentally wipe anyone.
//
// Soft-delete (set deletedAt on each entry) matches the per-entry
// Discard pattern; admin Patch Exports still see the records in their
// audit-trail CSV. The user's own ledger view filters them out.
//
// Response:
//   200 { ok: true, userId, scope, patchVersion?, jobsCleared,
//         salesCleared, clearedAt }
//   400 { error: "Missing or invalid confirmation" | "userId required"
//                | "Invalid scope" | "Unknown patchVersion" }
//   401 { error: "Not authenticated" }
//   403 { error: "Admin access required" }
//   404 { error: "User not found" }
//   503 { error: "Storage unavailable" }

import { getRedis } from "../_lib/redis.js";
import { getSession } from "../_lib/session.js";
import { isAdminSession } from "../_lib/admin.js";
import { getUserMeta } from "../_lib/userIndex.js";
import { softClearLedger } from "../_lib/ledgerOps.js";
import { patchRange } from "../_lib/patches.js";

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
  if (body.confirm !== "CLEAR_USER_LEDGER") {
    return res.status(400).json({ error: "Missing or invalid confirmation" });
  }

  const userId = String(body.userId || "").trim();
  if (!userId) {
    return res.status(400).json({ error: "userId required" });
  }

  // Refuse to clear a userId we have no record of — prevents typo'd
  // userIds from creating phantom ledger keys via the soft-delete write.
  const meta = await getUserMeta(redis, userId);
  if (!meta) {
    return res.status(404).json({ error: "User not found" });
  }

  // Resolve scope. Default "all" preserves the original behavior for
  // any caller that omits the field.
  const scope = body.scope === "patch" ? "patch" : "all";
  let opts;
  let patchVersion;
  if (scope === "patch") {
    patchVersion = String(body.patchVersion || "").trim();
    if (!patchVersion) {
      return res.status(400).json({ error: "patchVersion required for scope=patch" });
    }
    const range = patchRange(patchVersion);
    if (!range) {
      return res.status(400).json({ error: "Unknown patchVersion" });
    }
    opts = { from: range.from, to: range.to };
  }

  const { jobsCleared, salesCleared } = await softClearLedger(redis, userId, opts);

  return res.status(200).json({
    ok: true,
    userId,
    scope,
    ...(scope === "patch" ? { patchVersion } : {}),
    jobsCleared,
    salesCleared,
    clearedAt: Date.now(),
  });
}
