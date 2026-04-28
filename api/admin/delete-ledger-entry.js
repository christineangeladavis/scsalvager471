// POST /api/admin/delete-ledger-entry
//
// Admin-only. Soft-deletes a single refinery job or sell order
// belonging to the target user. Body:
//   { userId, kind: "job" | "sale", entryId, confirm: "DELETE_ENTRY" }
//
// Response:
//   200 { ok: true, userId, kind, entryId, deletedAt }
//   400 { error: "Missing or invalid confirmation" | "userId required"
//                | "kind must be job or sale" | "entryId required" }
//   401 { error: "Not authenticated" }
//   403 { error: "Admin access required" }
//   404 { error: "User not found" | "Entry not found" }
//   503 { error: "Storage unavailable" }

import { getRedis } from "../_lib/redis.js";
import { getSession } from "../_lib/session.js";
import { isAdminSession } from "../_lib/admin.js";
import { getUserMeta } from "../_lib/userIndex.js";
import { softDeleteLedgerEntry } from "../_lib/ledgerOps.js";

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
    try { body = JSON.parse(body); } catch { body = null; }
  }
  if (!body || typeof body !== "object") {
    return res.status(400).json({ error: "Invalid JSON" });
  }
  if (body.confirm !== "DELETE_ENTRY") {
    return res.status(400).json({ error: "Missing or invalid confirmation" });
  }

  const userId = String(body.userId || "").trim();
  if (!userId) return res.status(400).json({ error: "userId required" });
  const kind = body.kind;
  if (kind !== "job" && kind !== "sale") {
    return res.status(400).json({ error: "kind must be job or sale" });
  }
  const entryId = String(body.entryId || "").trim();
  if (!entryId) return res.status(400).json({ error: "entryId required" });

  const meta = await getUserMeta(redis, userId);
  if (!meta) return res.status(404).json({ error: "User not found" });

  const { deleted } = await softDeleteLedgerEntry(redis, userId, kind, entryId);
  if (!deleted) {
    return res.status(404).json({ error: "Entry not found" });
  }

  return res.status(200).json({
    ok: true,
    userId,
    kind,
    entryId,
    deletedAt: Date.now(),
  });
}
