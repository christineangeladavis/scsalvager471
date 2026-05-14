// POST /api/admin/clear-announcements
//
// Admin-only. Wipes the site-wide announcement list — sets the
// global `site:announcements` Redis key to an empty array so the
// Home-tab yellow banner clears immediately for every visitor.
//
// Distinct from posting an empty announcement: the public-read
// /api/announcements endpoint filters out entries older than 24 h,
// but never-clears them out of storage until a new post pushes
// them off the MAX_ANNOUNCEMENTS tail. This endpoint nukes the
// list outright.
//
// Response shape:
//   { ok: true, cleared: <count> }

import { getRedis } from "../_lib/redis.js";
import { getSession } from "../_lib/session.js";
import { isAdminSession } from "../_lib/admin.js";

const ANNOUNCEMENTS_KEY = "site:announcements";

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
    return res.status(503).json({ error: "Storage unavailable" });
  }

  const session = await getSession(req, redis);
  if (!session) return res.status(401).json({ error: "Not authenticated" });
  if (!isAdminSession(session)) {
    return res.status(403).json({ error: "Admin access required" });
  }

  try {
    const existing = (await redis.get(ANNOUNCEMENTS_KEY)) || [];
    const count = Array.isArray(existing) ? existing.length : 0;
    await redis.set(ANNOUNCEMENTS_KEY, []);
    return res.status(200).json({ ok: true, cleared: count });
  } catch (e) {
    console.error(
      "POST /api/admin/clear-announcements failed:",
      e && e.message ? e.message : e
    );
    return res.status(500).json({ error: "Could not clear announcements" });
  }
}
