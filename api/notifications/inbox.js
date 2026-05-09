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
  };
}

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
      const safe = Array.isArray(list) ? list.map(publicEntry).filter(Boolean) : [];
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
