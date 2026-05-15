// GET /api/users/directory
//
// Returns a flat list of every registered user's display name so the
// Crew Salvage roster input can offer typeahead autofill against
// existing site users. Authenticated read — guests don't see the
// roster. Display names are already public on the Statistics
// leaderboard, so surfacing them again here doesn't expose anything
// new.
//
// Response:
//   200 { users: [{ username }] }
//   401 { error: "Not authenticated" }
//   503 { error: "Storage unavailable" }
//
// userId is intentionally omitted from the response — the autofill
// only needs the name string, and resolving names to userIds happens
// server-side in /api/me/credit-crew-session against the same
// userIndex. Keeps the cross-user surface minimal.

import { getRedis } from "../_lib/redis.js";
import { getSession } from "../_lib/session.js";
import { listUserIds, getUserMeta } from "../_lib/userIndex.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  // Per-user cached on the browser side; refresh on each Crew Salvage
  // tab mount via a cache-buster. Edge cache is short so a fresh
  // signup surfaces in the typeahead within ~60 s.
  res.setHeader(
    "cache-control",
    "public, max-age=30, s-maxage=60, stale-while-revalidate=300"
  );

  let redis;
  try {
    redis = getRedis();
  } catch {
    return res.status(503).json({ error: "Storage unavailable" });
  }

  const session = await getSession(req, redis);
  if (!session) return res.status(401).json({ error: "Not authenticated" });

  try {
    const ids = await listUserIds(redis);
    const users = [];
    for (const id of ids) {
      try {
        const meta = await getUserMeta(redis, id);
        if (!meta || !meta.username) continue;
        users.push({ username: meta.username });
      } catch {
        // skip individual failures
      }
    }
    // Stable alphabetical sort so the typeahead order doesn't shift
    // between renders when Redis returns ids in arbitrary set order.
    users.sort((a, b) => a.username.localeCompare(b.username));
    return res.status(200).json({ users });
  } catch (e) {
    console.error(
      "GET /api/users/directory failed:",
      e && e.message ? e.message : e
    );
    return res.status(500).json({ error: "Could not load directory" });
  }
}
