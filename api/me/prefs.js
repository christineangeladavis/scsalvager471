// GET  /api/me/prefs  — returns the logged-in user's preferences (defaults applied)
// POST /api/me/prefs  — partial update; body is
//                       { discordNotifications?: boolean, rsiHandle?: string }
//                       returns the full merged preferences object on success
// Returns 401 if not logged in, 503 if Redis is unavailable.

import { getRedis } from "../_lib/redis.js";
import { getSession } from "../_lib/session.js";
import {
  getPrefs,
  updatePrefs,
  sanitizePrefsUpdate,
  generateRsiHandleToken,
} from "../_lib/prefs.js";

export default async function handler(req, res) {
  let redis;
  try {
    redis = getRedis();
  } catch (e) {
    console.error("/api/me/prefs — Redis unavailable:", e.message);
    return res.status(503).json({ error: e.message });
  }

  const session = await getSession(req, redis);
  if (!session) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  res.setHeader("cache-control", "private, no-store");

  if (req.method === "GET") {
    try {
      const prefs = await getPrefs(redis, session.userId);
      return res.status(200).json({ prefs });
    } catch (e) {
      console.error("GET /api/me/prefs failed:", e && e.message ? e.message : e);
      return res.status(500).json({ error: "Could not load preferences" });
    }
  }

  if (req.method === "POST") {
    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        body = null;
      }
    }
    if (!body || typeof body !== "object") {
      return res.status(400).json({ error: "Invalid JSON" });
    }

    const update = sanitizePrefsUpdate(body);
    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: "No valid preference fields provided" });
    }

    try {
      // If the RSI handle is changing, reset verification + issue a fresh
      // verification token. The token is what the user pastes into their
      // RSI Short Bio; binding a new token to a new handle prevents stale
      // tokens being reused after a handle swap. When the handle is
      // cleared we drop the token entirely.
      if ("rsiHandle" in update) {
        const current = await getPrefs(redis, session.userId);
        if (update.rsiHandle !== current.rsiHandle) {
          update.rsiHandleVerified = false;
          update.rsiHandleVerifiedAt = null;
          update.rsiHandleToken = update.rsiHandle ? generateRsiHandleToken() : "";
        }
      }

      const prefs = await updatePrefs(redis, session.userId, update);
      return res.status(200).json({ prefs });
    } catch (e) {
      console.error("POST /api/me/prefs failed:", e && e.message ? e.message : e);
      return res.status(500).json({ error: "Could not save preferences" });
    }
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Method not allowed" });
}
