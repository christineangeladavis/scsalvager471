// POST /api/admin/message-user
//
// Admin-only. Sends an in-app message to one user's notification bell.
// The message ALWAYS displays as "SCSalvager Admin" — the acting admin's
// identity is recorded server-side for audit but never surfaced to the
// recipient.
//
// Request body: { userId: string, body: string }
// Response: { ok, id, count }
//
// Storage: Redis key `inbox:<userId>` → JSON array of
//   { id, body, createdAt, dismissedAt: null, fromAdminId }
// Capped at MAX_INBOX_PER_USER newest entries (oldest dropped on overflow).
//
// The recipient sees these via /api/notifications/inbox; the bell-render
// in src/App.jsx merges them into userNotifications with a hard-coded
// "SCSalvager Admin" sender label.

import { getRedis } from "../_lib/redis.js";
import { getSession } from "../_lib/session.js";
import { isAdminSession } from "../_lib/admin.js";

const MAX_INBOX_PER_USER = 20;
const MAX_BODY_CHARS = 1000;

export function inboxKey(userId) {
  return `inbox:${userId}`;
}

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
    try {
      body = JSON.parse(body);
    } catch {
      body = null;
    }
  }
  if (!body || typeof body !== "object") {
    return res.status(400).json({ error: "Invalid JSON" });
  }

  const targetUserId = typeof body.userId === "string" ? body.userId.trim() : "";
  const messageBody = typeof body.body === "string" ? body.body.trim() : "";
  if (!targetUserId) return res.status(400).json({ error: "Missing userId" });
  if (!messageBody) return res.status(400).json({ error: "Missing message body" });
  if (messageBody.length > MAX_BODY_CHARS) {
    return res.status(400).json({
      error: `Message body exceeds ${MAX_BODY_CHARS}-character limit`,
    });
  }

  try {
    const key = inboxKey(targetUserId);
    const existing = (await redis.get(key)) || [];
    const list = Array.isArray(existing) ? existing.slice() : [];
    const entry = {
      id: `admin-msg-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      body: messageBody,
      createdAt: Date.now(),
      dismissedAt: null,
      // "admin" means SCSalvager Admin sent it. The companion
      // /api/notifications/inbox POST action="send" writes "user"
      // for user-originated entries. Threads are the same array;
      // direction is read off this field.
      from: "admin",
      // Recorded for audit only — never returned to the recipient.
      fromAdminId: session.userId,
      // Optional reply linkage when the admin is responding to a
      // user-originated entry; populated by the admin-thread API
      // when it forwards a reply.
      replyToId: typeof body.replyToId === "string" ? body.replyToId.slice(0, 80) : null,
    };
    list.unshift(entry);
    // Trim to newest MAX_INBOX_PER_USER. Drops oldest entries first
    // (which are at the tail since unshift puts new ones at the head).
    if (list.length > MAX_INBOX_PER_USER) list.length = MAX_INBOX_PER_USER;
    await redis.set(key, list);
    return res.status(200).json({ ok: true, id: entry.id, count: list.length });
  } catch (e) {
    console.error("POST /api/admin/message-user failed:", e && e.message ? e.message : e);
    return res.status(500).json({ error: "Could not send message" });
  }
}
