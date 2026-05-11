// POST /api/me/heartbeat
//
// Bumps the caller's lastSeenAt in the user index. Called periodically
// by the client while the tab is visible and the user is logged in;
// admin presence (online/offline) in the Active Users view is derived
// from how recently this fired.
//
// Returns 204 No Content on success — the client doesn't need anything
// back. 401 if not authenticated; the client should stop heartbeating
// once it sees that and only resume after re-auth.

import { getRedis } from "../_lib/redis.js";
import { getSession } from "../_lib/session.js";
import { recordUserHeartbeat } from "../_lib/userIndex.js";

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

  // Optional JSON body: { client: "desktop" | "web" } — drives the
  // "Online · D / W" suffix in the admin All Users view. Older
  // clients that don't send a body just refresh lastSeenAt and
  // leave the stored client kind untouched.
  let client = null;
  try {
    const body = req.body && typeof req.body === "object" ? req.body : null;
    if (body && (body.client === "desktop" || body.client === "web")) {
      client = body.client;
    }
  } catch {
    // Body parse failure — silently fall back to client=null.
  }

  await recordUserHeartbeat(redis, session.userId, client);
  return res.status(204).end();
}
