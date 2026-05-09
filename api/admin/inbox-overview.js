// GET  /api/admin/inbox-overview                — list incoming user mail
// POST /api/admin/inbox-overview { action: "dismiss", id } — hide one
//                                                              entry from
//                                                              this admin's
//                                                              overview
//
// Admin-only. Aggregates user → admin messages across every
// indexed user so admins can see incoming user mail in their own
// Messages mailbox without having to click each user individually.
//
// "Dismiss" tracks per-admin local state — the entry stays in the
// originating user's inbox (and shows in the user-detail thread)
// but stops appearing in this admin's overview. Storage:
//   `admin-overview-dismissed:<adminUserId>` → array of entry ids.
// Cap at MAX_DISMISSED_PER_ADMIN, oldest dropped on overflow.
//
// Response shapes:
//   GET  → { messages: [{ id, userId, username, body, createdAt,
//                          replyToId, dismissedAt }] }
//   POST → { ok: true }

import { getRedis } from "../_lib/redis.js";
import { getSession } from "../_lib/session.js";
import { isAdminSession } from "../_lib/admin.js";
import { listUserIds, getUserMeta } from "../_lib/userIndex.js";
import { inboxKey } from "../notifications/inbox.js";

const MAX_OVERVIEW_ENTRIES = 200;
const MAX_DISMISSED_PER_ADMIN = 500;

function dismissedKey(adminUserId) {
  return `admin-overview-dismissed:${adminUserId}`;
}

export default async function handler(req, res) {
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

  if (req.method === "POST") {
    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { body = null; }
    }
    if (!body || typeof body !== "object") return res.status(400).json({ error: "Invalid JSON" });
    const action = typeof body.action === "string" ? body.action : "";
    const id = typeof body.id === "string" ? body.id : "";
    if (action !== "dismiss") return res.status(400).json({ error: "Unknown action" });
    if (!id) return res.status(400).json({ error: "Missing id" });
    try {
      const dKey = dismissedKey(session.userId);
      const existing = (await redis.get(dKey)) || [];
      const arr = Array.isArray(existing) ? existing.slice() : [];
      if (!arr.includes(id)) {
        arr.unshift(id);
        if (arr.length > MAX_DISMISSED_PER_ADMIN) arr.length = MAX_DISMISSED_PER_ADMIN;
        await redis.set(dKey, arr);
      }
      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error("POST /api/admin/inbox-overview dismiss failed:", e && e.message ? e.message : e);
      return res.status(500).json({ error: "Could not dismiss entry" });
    }
  }

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Per-admin dismissed set so this admin's "remove from my
  // overview" decisions don't affect other admins or the user's
  // own thread visibility.
  let dismissed = new Set();
  try {
    const raw = (await redis.get(dismissedKey(session.userId))) || [];
    if (Array.isArray(raw)) dismissed = new Set(raw);
  } catch {
    // ignore — overview just won't filter
  }

  let userIds = [];
  try {
    userIds = await listUserIds(redis);
  } catch (e) {
    return res.status(500).json({ error: "Could not list users" });
  }

  const out = [];
  for (const userId of userIds) {
    let list = [];
    try {
      const raw = (await redis.get(inboxKey(userId))) || [];
      list = Array.isArray(raw) ? raw : [];
    } catch {
      continue;
    }
    if (list.length === 0) continue;
    let username = "";
    try {
      const meta = await getUserMeta(redis, userId);
      username = (meta && meta.username) || "";
    } catch {
      username = "";
    }
    for (const e of list) {
      if (!e || typeof e !== "object") continue;
      if (e.from !== "user") continue;
      if (e.deletedAt) continue;
      if (typeof e.id !== "string") continue;
      if (dismissed.has(e.id)) continue;
      out.push({
        id: e.id,
        userId,
        username: username || "Unknown",
        body: typeof e.body === "string" ? e.body : "",
        createdAt: Number.isFinite(e.createdAt) ? e.createdAt : 0,
        replyToId: typeof e.replyToId === "string" ? e.replyToId : null,
        dismissedAt: Number.isFinite(e.dismissedAt) ? e.dismissedAt : null,
      });
    }
  }

  out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const trimmed = out.slice(0, MAX_OVERVIEW_ENTRIES);
  return res.status(200).json({ messages: trimmed });
}
