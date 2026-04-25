// POST /api/notifications/disconnect
// Clears the user's notification link and turns notifications off.
// Does not revoke the OAuth grant on Discord's side — the user can do that
// from their Discord account settings if they want full cleanup. Returns
// the updated prefs so the client can refresh its UI in one round-trip.

import { getRedis } from "../_lib/redis.js";
import { getSession } from "../_lib/session.js";
import { markNotificationsUnlinked } from "../_lib/prefs.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

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

  res.setHeader("cache-control", "private, no-store");

  try {
    const prefs = await markNotificationsUnlinked(redis, session.userId);
    return res.status(200).json({ ok: true, prefs });
  } catch (e) {
    console.error("/api/notifications/disconnect failed:", e && e.message ? e.message : e);
    return res.status(500).json({ error: "Could not disconnect notifications" });
  }
}
