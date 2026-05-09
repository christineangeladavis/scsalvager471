// POST /api/admin/broadcast-message
//
// Admin-only. Pushes a single message to EVERY indexed user's inbox.
// Same per-user shape as /api/admin/message-user (from="admin",
// fromAdminId stamped for audit), so the recipient experience is
// identical to a one-off message — they see "SCSalvager Admin" with
// no broadcast indicator.
//
// Request body: { body: string }
// Response: { ok, recipientCount, errorCount, broadcastId }
//
// Fanout: iterates listUserIds() and writes one inbox entry to each
// `inbox:<userId>` Redis key. Errors per user are collected and
// surfaced via errorCount in the response — broadcasts don't fail
// loudly on a single user's Redis hiccup.

import { getRedis } from "../_lib/redis.js";
import { getSession } from "../_lib/session.js";
import { isAdminSession } from "../_lib/admin.js";
import { listUserIds } from "../_lib/userIndex.js";
import { inboxKey } from "../notifications/inbox.js";

const MAX_INBOX_PER_USER = 50;
const MAX_BODY_CHARS = 1000;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
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
  if (!session) return res.status(401).json({ error: "Not authenticated" });
  if (!isAdminSession(session)) return res.status(403).json({ error: "Forbidden" });

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  if (!body || typeof body !== "object") return res.status(400).json({ error: "Invalid JSON" });
  const messageBody = typeof body.body === "string" ? body.body.trim() : "";
  if (!messageBody) return res.status(400).json({ error: "Missing message body" });
  if (messageBody.length > MAX_BODY_CHARS) {
    return res.status(400).json({
      error: `Message body exceeds ${MAX_BODY_CHARS}-character limit`,
    });
  }

  const broadcastId = `broadcast-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  let userIds = [];
  try {
    userIds = await listUserIds(redis);
  } catch (e) {
    return res.status(500).json({ error: "Could not list users" });
  }

  let recipientCount = 0;
  let errorCount = 0;
  const now = Date.now();
  for (const userId of userIds) {
    try {
      const key = inboxKey(userId);
      const existing = (await redis.get(key)) || [];
      const list = Array.isArray(existing) ? existing.slice() : [];
      list.unshift({
        // Per-recipient unique id so dismiss state is independent.
        id: `admin-msg-${now}-${Math.floor(Math.random() * 1e6)}`,
        body: messageBody,
        createdAt: now,
        dismissedAt: null,
        from: "admin",
        fromAdminId: session.userId,
        replyToId: null,
        // Tag so the dashboard / future audits can group entries
        // that came from the same broadcast.
        broadcastId,
      });
      if (list.length > MAX_INBOX_PER_USER) list.length = MAX_INBOX_PER_USER;
      await redis.set(key, list);
      recipientCount++;
    } catch (e) {
      errorCount++;
      console.warn(
        "Broadcast: failed for user",
        userId,
        e && e.message ? e.message : e
      );
    }
  }

  return res.status(200).json({ ok: true, recipientCount, errorCount, broadcastId });
}
