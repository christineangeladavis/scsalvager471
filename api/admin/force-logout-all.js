// POST /api/admin/force-logout-all
//
// Admin-only. Invalidates every active session in Redis except the
// caller's own — admin stays logged in so the panel keeps working.
//
// Response shape:
//   { invalidated: <number of sessions deleted> }
//
// Implementation: SCAN all `session:*` keys and DEL each (skipping the
// caller's). SCAN is not strictly atomic — sessions created while we're
// iterating may slip through — but that's fine for a manual admin
// "boot everyone" operation.

import { getRedis } from "../_lib/redis.js";
import { getSession } from "../_lib/session.js";
import { isAdminSession } from "../_lib/admin.js";

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
  if (!session) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  if (!isAdminSession(session)) {
    return res.status(403).json({ error: "Admin access required" });
  }

  const myKey = session.token ? `session:${session.token}` : null;
  let cursor = "0";
  let invalidated = 0;

  try {
    do {
      const result = await redis.scan(cursor, {
        match: "session:*",
        count: 200,
      });
      // @upstash/redis returns [nextCursor, keys].
      const next = Array.isArray(result) ? result[0] : result?.cursor;
      const keys = Array.isArray(result) ? result[1] : result?.keys;
      cursor = String(next ?? "0");

      if (Array.isArray(keys) && keys.length > 0) {
        // Skip the admin's own session so they don't bounce themselves out
        // mid-action and lose the panel.
        const toDelete = keys.filter((k) => k !== myKey);
        if (toDelete.length > 0) {
          await redis.del(...toDelete);
          invalidated += toDelete.length;
        }
      }
    } while (cursor !== "0");
  } catch (e) {
    console.error(
      "force-logout-all: scan/del failed:",
      e && e.message ? e.message : e
    );
    return res.status(500).json({
      error: "Storage error during logout sweep",
      invalidated,
    });
  }

  return res.status(200).json({ invalidated });
}
