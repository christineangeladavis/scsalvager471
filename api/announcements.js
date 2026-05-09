// GET /api/announcements
//
// Public-ish — readable by any logged-in user (and by guests since
// the Home tab is visible without auth, we degrade gracefully when
// no session exists). Returns active (under 24 h since createdAt)
// site-wide announcements posted by admins via
// /api/admin/announcement.
//
// Response: { announcements: [{ id, body, createdAt }] }
//
// `postedByAdminId` is intentionally stripped before serialization —
// readers see only the announcement body, not which operator posted
// it. Banner on Home tab consumes this list and surfaces the
// newest under-24h entry.

import { getRedis } from "./_lib/redis.js";
import { ANNOUNCEMENTS_KEY } from "./admin/announcement.js";

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  // Cache lightly so a polling loop doesn't hammer Redis. 30 s
  // matches the Messages mailbox polling cadence on the client.
  res.setHeader("cache-control", "public, max-age=30");

  let redis;
  try {
    redis = getRedis();
  } catch (e) {
    return res.status(200).json({ announcements: [] });
  }

  try {
    const list = (await redis.get(ANNOUNCEMENTS_KEY)) || [];
    if (!Array.isArray(list)) return res.status(200).json({ announcements: [] });
    const cutoff = Date.now() - TWENTY_FOUR_HOURS_MS;
    const active = list
      .filter((e) => e && Number.isFinite(e.createdAt) && e.createdAt >= cutoff)
      .map((e) => ({
        id: typeof e.id === "string" ? e.id : "",
        body: typeof e.body === "string" ? e.body : "",
        createdAt: Number(e.createdAt) || 0,
      }))
      .filter((e) => e.id && e.body)
      .sort((a, b) => b.createdAt - a.createdAt);
    return res.status(200).json({ announcements: active });
  } catch (e) {
    console.error("GET /api/announcements failed:", e && e.message ? e.message : e);
    return res.status(200).json({ announcements: [] });
  }
}
