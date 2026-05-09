// GET /api/admin/inbox-overview
//
// Admin-only. Aggregates user → admin messages across every
// indexed user so admins can see incoming user mail in their own
// Messages mailbox without having to click each user individually.
//
// Iterates listUserIds(), reads each `inbox:<userId>`, picks
// entries with from="user" and no deletedAt set, and returns them
// flattened with the originating userId + username attached.
//
// Response: { messages: [{ id, userId, username, body, createdAt,
//                          replyToId, dismissedAt }] }
//
// Sorted newest-first. Cap at MAX_OVERVIEW_ENTRIES so the payload
// stays bounded even on a large user roster.

import { getRedis } from "../_lib/redis.js";
import { getSession } from "../_lib/session.js";
import { isAdminSession } from "../_lib/admin.js";
import { listUserIds, getUserMeta } from "../_lib/userIndex.js";
import { inboxKey } from "../notifications/inbox.js";

const MAX_OVERVIEW_ENTRIES = 200;

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
