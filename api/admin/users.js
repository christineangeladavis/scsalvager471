// GET /api/admin/users
//
// Admin-only. Returns every user from the login index whose lastLoginAt is
// within the last 24h, sorted by lastLoginAt descending. Treats that
// window as a proxy for "currently logged in" — sessions live for 7 days,
// so a user who hasn't logged in for 24h+ may or may not still have a
// valid cookie, but users active inside the window almost certainly do.
//
// Response shape:
//   {
//     fetchedAt: <ms>,
//     activeWindowMs: 86400000,
//     onlineWindowMs: 90000,
//     users: [
//       { userId, username, rsiHandle, rsiHandleVerified, lastLoginAt,
//         lastSeenAt, isOnline, dmsEnabled }
//     ]
//   }
//
// rsiHandle is the user-entered Star Citizen handle (from prefs); empty
// string when not set. rsiHandleVerified is true only after the user
// has passed the RSI Short-Bio token check.
//
// isOnline is derived from lastSeenAt — true when the heartbeat fired
// within the last ~90 seconds (covers a missed beat at the default 30s
// interval without false-flagging actual disconnects).

import { getRedis } from "../_lib/redis.js";
import { getSession } from "../_lib/session.js";
import { isAdminSession } from "../_lib/admin.js";
import { listUserIds, getUserMeta } from "../_lib/userIndex.js";
import { getPrefs } from "../_lib/prefs.js";

const ACTIVE_WINDOW_MS = 24 * 60 * 60 * 1000;
// Heartbeat fires every ~30s while the user has the tab open. 90s is
// 3 missed beats — beyond that we call them offline.
const ONLINE_WINDOW_MS = 90 * 1000;

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
  if (!session) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  if (!isAdminSession(session)) {
    return res.status(403).json({ error: "Admin access required" });
  }

  const now = Date.now();
  const cutoff = now - ACTIVE_WINDOW_MS;
  const onlineCutoff = now - ONLINE_WINDOW_MS;
  const userIds = await listUserIds(redis);

  const users = [];
  for (const userId of userIds) {
    const meta = await getUserMeta(redis, userId);
    if (!meta || !meta.lastLoginAt) continue;
    if (meta.lastLoginAt < cutoff) continue;
    // DMs count as "on" when the user is opted in AND has completed the
    // notification-link OAuth flow. Either side missing means we'd have
    // nowhere to deliver, so it's effectively off.
    const prefs = await getPrefs(redis, userId);
    const dmsEnabled = Boolean(
      prefs && prefs.discordNotifications && prefs.notificationLinkedAt
    );
    const isOnline = Boolean(meta.lastSeenAt && meta.lastSeenAt >= onlineCutoff);
    const rsiHandle =
      prefs && typeof prefs.rsiHandle === "string" ? prefs.rsiHandle : "";
    const rsiHandleVerified = Boolean(
      rsiHandle && prefs && prefs.rsiHandleVerified
    );
    users.push({
      userId,
      username: meta.username,
      rsiHandle,
      rsiHandleVerified,
      lastLoginAt: meta.lastLoginAt,
      lastSeenAt: meta.lastSeenAt || null,
      isOnline,
      dmsEnabled,
    });
  }

  // Sort: online users first (so admins can see who's actively on the
  // site at a glance), then by most recent login.
  users.sort((a, b) => {
    if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
    return b.lastLoginAt - a.lastLoginAt;
  });

  return res.status(200).json({
    fetchedAt: Date.now(),
    activeWindowMs: ACTIVE_WINDOW_MS,
    onlineWindowMs: ONLINE_WINDOW_MS,
    users,
  });
}
