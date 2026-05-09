// GET  /api/notifications/inbox          — read the caller's inbox
// POST /api/notifications/inbox          — { action: "dismiss", id } marks one entry dismissed
//
// Inbox entries are admin-authored messages that surface in the user's
// notification bell with a hardcoded "SCSalvager Admin" sender label.
// The acting admin's userId is stored on the server for audit but is
// NEVER returned in the response — recipients always see "SCSalvager
// Admin", never the individual operator's identity.
//
// Storage: Redis key `inbox:<userId>` → JSON array of
//   { id, body, createdAt, dismissedAt, fromAdminId }
// We strip `fromAdminId` before returning.

import { getRedis } from "../_lib/redis.js";
import { getSession } from "../_lib/session.js";

export function inboxKey(userId) {
  return `inbox:${userId}`;
}

function publicEntry(e) {
  if (!e || typeof e !== "object") return null;
  if (typeof e.id !== "string") return null;
  return {
    id: e.id,
    body: typeof e.body === "string" ? e.body : "",
    createdAt: Number.isFinite(e.createdAt) ? e.createdAt : 0,
    dismissedAt: Number.isFinite(e.dismissedAt) ? e.dismissedAt : null,
    // Direction marker — "admin" means the entry was authored by
    // SCSalvager Admin (via /api/admin/message-user); "user" means
    // the caller themselves authored it (via this endpoint's
    // action="send"). Default falls back to "admin" for legacy
    // entries written before threading existed.
    from: e.from === "user" ? "user" : "admin",
    replyToId: typeof e.replyToId === "string" ? e.replyToId : null,
    // Surfaced so the client can pick out broadcast entries (e.g.
    // for the yellow Home-tab banner). Same value across every
    // recipient of one broadcast send.
    broadcastId: typeof e.broadcastId === "string" ? e.broadcastId : null,
  };
}

const MAX_INBOX_PER_USER = 50;
const MAX_BODY_CHARS = 1000;

export default async function handler(req, res) {
  let redis;
  try {
    redis = getRedis();
  } catch (e) {
    return res.status(503).json({ error: e.message });
  }
  const session = await getSession(req, redis);
  if (!session) return res.status(401).json({ error: "Not authenticated" });
  res.setHeader("cache-control", "private, no-store");

  const key = inboxKey(session.userId);

  if (req.method === "GET") {
    try {
      const list = (await redis.get(key)) || [];
      // Filter out user-deleted entries before mapping to public
      // shape — soft-deleted entries stay in Redis (admins still
      // see full history via /api/admin/inbox) but the user's own
      // mailbox view treats them as gone.
      const safe = Array.isArray(list)
        ? list.filter((e) => !e || !e.deletedAt).map(publicEntry).filter(Boolean)
        : [];
      return res.status(200).json({ inbox: safe });
    } catch (e) {
      console.error("GET /api/notifications/inbox failed:", e && e.message ? e.message : e);
      return res.status(500).json({ error: "Could not load inbox" });
    }
  }

  if (req.method === "POST") {
    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { body = null; }
    }
    if (!body || typeof body !== "object") {
      return res.status(400).json({ error: "Invalid JSON" });
    }
    const action = typeof body.action === "string" ? body.action : "";
    const id = typeof body.id === "string" ? body.id : "";
    if (action === "send" || action === "reply") {
      // User-originated message to SCSalvager Admin. Stored in the
      // user's own inbox so the conversation history stays in one
      // array. Admins read these via /api/admin/inbox?userId=... and
      // can reply with /api/admin/message-user (with the optional
      // replyToId pointing back here).
      const messageBody = typeof body.body === "string" ? body.body.trim() : "";
      if (!messageBody) return res.status(400).json({ error: "Missing message body" });
      if (messageBody.length > MAX_BODY_CHARS) {
        return res.status(400).json({
          error: `Message body exceeds ${MAX_BODY_CHARS}-character limit`,
        });
      }
      try {
        const list = (await redis.get(key)) || [];
        const arr = Array.isArray(list) ? list.slice() : [];
        const entry = {
          id: `user-msg-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
          body: messageBody,
          createdAt: Date.now(),
          dismissedAt: null,
          from: "user",
          replyToId: action === "reply" && typeof body.replyToId === "string"
            ? body.replyToId.slice(0, 80)
            : null,
        };
        arr.unshift(entry);
        if (arr.length > MAX_INBOX_PER_USER) arr.length = MAX_INBOX_PER_USER;
        await redis.set(key, arr);
        return res.status(200).json({ ok: true, id: entry.id, count: arr.length });
      } catch (e) {
        console.error("POST /api/notifications/inbox send failed:", e && e.message ? e.message : e);
        return res.status(500).json({ error: "Could not send message" });
      }
    }
    if (action === "delete") {
      // User-initiated delete. SOFT delete only — sets deletedAt on
      // the entry so admins viewing /api/admin/inbox still see it
      // (with a "deleted by user" indicator) for moderation /
      // audit purposes. The user's own GET filters these out.
      if (!id) return res.status(400).json({ error: "Missing id" });
      try {
        const list = (await redis.get(key)) || [];
        if (!Array.isArray(list)) return res.status(200).json({ ok: true });
        let touched = false;
        const next = list.map((e) => {
          if (e && e.id === id && !e.deletedAt) {
            touched = true;
            return { ...e, deletedAt: Date.now() };
          }
          return e;
        });
        if (touched) await redis.set(key, next);
        return res.status(200).json({ ok: true, updated: touched });
      } catch (e) {
        console.error("POST /api/notifications/inbox delete failed:", e && e.message ? e.message : e);
        return res.status(500).json({ error: "Could not delete entry" });
      }
    }
    if (action === "dismiss") {
      if (!id) return res.status(400).json({ error: "Missing id" });
      try {
        const list = (await redis.get(key)) || [];
        if (!Array.isArray(list)) return res.status(200).json({ ok: true });
        let touched = false;
        const next = list.map((e) => {
          if (e && e.id === id && !e.dismissedAt) {
            touched = true;
            return { ...e, dismissedAt: Date.now() };
          }
          return e;
        });
        if (touched) await redis.set(key, next);
        return res.status(200).json({ ok: true, updated: touched });
      } catch (e) {
        console.error("POST /api/notifications/inbox dismiss failed:", e && e.message ? e.message : e);
        return res.status(500).json({ error: "Could not dismiss entry" });
      }
    }
    return res.status(400).json({ error: "Unknown action" });
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Method not allowed" });
}
