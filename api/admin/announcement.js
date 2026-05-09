// POST /api/admin/announcement
//
// Admin-only. Posts a site-wide announcement to the global
// `site:announcements` Redis key. Surfaces on the Home tab as a
// yellow banner under the HOME nav for every visitor (not
// per-user — distinct from /api/admin/broadcast-message which
// fans out into per-user inboxes).
//
// Storage: Redis key `site:announcements` → JSON array of
//   { id, body, createdAt, postedByAdminId }
// Capped at MAX_ANNOUNCEMENTS newest entries.
//
// Public read endpoint at /api/announcements returns the active
// (under 24 h old) announcements without auth.

import { getRedis } from "../_lib/redis.js";
import { getSession } from "../_lib/session.js";
import { isAdminSession } from "../_lib/admin.js";

const MAX_ANNOUNCEMENTS = 20;
const MAX_BODY_CHARS = 1000;

export const ANNOUNCEMENTS_KEY = "site:announcements";

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
    return res.status(503).json({ error: e.message });
  }
  const session = await getSession(req, redis);
  if (!session) return res.status(401).json({ error: "Not authenticated" });
  if (!isAdminSession(session)) return res.status(403).json({ error: "Forbidden" });

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  if (!body || typeof body !== "object") return res.status(400).json({ error: "Invalid JSON" });
  const messageBody = typeof body.body === "string" ? body.body.trim() : "";
  if (!messageBody) return res.status(400).json({ error: "Missing body" });
  if (messageBody.length > MAX_BODY_CHARS) {
    return res.status(400).json({
      error: `Announcement body exceeds ${MAX_BODY_CHARS}-character limit`,
    });
  }

  try {
    const existing = (await redis.get(ANNOUNCEMENTS_KEY)) || [];
    const list = Array.isArray(existing) ? existing.slice() : [];
    const entry = {
      id: `announcement-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      body: messageBody,
      createdAt: Date.now(),
      postedByAdminId: session.userId,
    };
    list.unshift(entry);
    if (list.length > MAX_ANNOUNCEMENTS) list.length = MAX_ANNOUNCEMENTS;
    await redis.set(ANNOUNCEMENTS_KEY, list);
    return res.status(200).json({ ok: true, id: entry.id, count: list.length });
  } catch (e) {
    console.error("POST /api/admin/announcement failed:", e && e.message ? e.message : e);
    return res.status(500).json({ error: "Could not post announcement" });
  }
}
