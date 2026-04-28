// POST /api/admin/edit-ledger-entry
//
// Admin-only. Apply a partial update to a single refinery job or
// sell order belonging to the target user. Server-managed bookkeeping
// (notification ids, deletedAt, id itself) is never editable. Body:
//   {
//     userId,
//     kind: "job" | "sale",
//     entryId,
//     patch: { ...editable fields... },
//     confirm: "EDIT_ENTRY"
//   }
//
// Editable fields:
//   job:  material, materialScu, location, method, yield, cost,
//         timeMinutes, submittedAt, completesAt, pickedUpAt
//   sale: material, scu, location, playerName, aUEC, submittedAt
//
// The merged entry runs through the same sanitize* helper used by
// /api/ledger.js so length caps and numeric coercion stay aligned.
//
// Response:
//   200 { ok: true, userId, kind, entryId, entry, updatedAt }
//   400 { error: ... }
//   401/403/404/503 — same pattern as the other admin endpoints

import { getRedis } from "../_lib/redis.js";
import { getSession } from "../_lib/session.js";
import { isAdminSession } from "../_lib/admin.js";
import { getUserMeta } from "../_lib/userIndex.js";
import { editLedgerEntry } from "../_lib/ledgerOps.js";

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
  if (body.confirm !== "EDIT_ENTRY") {
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
  const patch = body.patch;
  if (!patch || typeof patch !== "object") {
    return res.status(400).json({ error: "patch object required" });
  }

  const meta = await getUserMeta(redis, userId);
  if (!meta) return res.status(404).json({ error: "User not found" });

  const result = await editLedgerEntry(redis, userId, kind, entryId, patch);
  if (!result.updated) {
    return res.status(404).json({ error: "Entry not found or not editable" });
  }

  return res.status(200).json({
    ok: true,
    userId,
    kind,
    entryId,
    entry: result.entry,
    updatedAt: Date.now(),
  });
}
