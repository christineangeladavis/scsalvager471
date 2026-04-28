// GET /api/admin/guest-logins
//
// Admin-only. Returns the most recent anonymous-visitor records from the
// `guests:logins` list (newest first). Each entry is a single visit
// captured the first time a browser hits the site within a 24h window.
//
// Response shape:
//   {
//     fetchedAt: <ms>,
//     entries: [
//       { ts, ip, ua, country }
//     ]
//   }
//
// `limit` query param (default 200, capped at 1000) trims the response
// for the table view.

import { getRedis } from "../_lib/redis.js";
import { getSession } from "../_lib/session.js";
import { isAdminSession } from "../_lib/admin.js";
import { listRecentGuestLogins } from "../_lib/guestLogins.js";

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

  const limitRaw = Number(req.query?.limit);
  const limit = Number.isFinite(limitRaw) ? limitRaw : 200;
  const entries = await listRecentGuestLogins(redis, { limit });

  return res.status(200).json({
    fetchedAt: Date.now(),
    entries,
  });
}
