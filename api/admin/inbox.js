// GET /api/admin/inbox?userId=<id>
//
// Admin-only. Returns one user's full message thread (admin → user
// AND user → admin entries together, newest-first). Used by the Admin
// Panel user-detail modal to surface incoming user replies alongside
// the admin's own outbound history.
//
// Response: { thread: [{ id, body, createdAt, dismissedAt, from, replyToId }] }
//
// `from` is "admin" or "user". `fromAdminId` is intentionally NOT
// returned — recipients (and admins viewing other admins' messages)
// see only the unified "SCSalvager Admin" sender label.

import { getRedis } from "../_lib/redis.js";
import { getSession } from "../_lib/session.js";
import { isAdminSession } from "../_lib/admin.js";
import { inboxKey } from "../notifications/inbox.js";

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
  if (!session) return res.status(401).json({ error: "Not authenticated" });
  if (!isAdminSession(session)) return res.status(403).json({ error: "Forbidden" });

  const userId = typeof req.query.userId === "string" ? req.query.userId.trim() : "";
  if (!userId) return res.status(400).json({ error: "Missing userId" });

  try {
    const list = (await redis.get(inboxKey(userId))) || [];
    const arr = Array.isArray(list) ? list : [];
    // Admins see EVERY entry — including ones the user soft-deleted
    // via the inbox delete action. deletedAt is surfaced so the UI
    // can render a "deleted by user" tag on those rows.
    const thread = arr
      .map((e) => {
        if (!e || typeof e !== "object" || typeof e.id !== "string") return null;
        return {
          id: e.id,
          body: typeof e.body === "string" ? e.body : "",
          createdAt: Number.isFinite(e.createdAt) ? e.createdAt : 0,
          dismissedAt: Number.isFinite(e.dismissedAt) ? e.dismissedAt : null,
          deletedAt: Number.isFinite(e.deletedAt) ? e.deletedAt : null,
          from: e.from === "user" ? "user" : "admin",
          replyToId: typeof e.replyToId === "string" ? e.replyToId : null,
          broadcastId: typeof e.broadcastId === "string" ? e.broadcastId : null,
        };
      })
      .filter(Boolean);
    return res.status(200).json({ thread });
  } catch (e) {
    console.error("GET /api/admin/inbox failed:", e && e.message ? e.message : e);
    return res.status(500).json({ error: "Could not load thread" });
  }
}
