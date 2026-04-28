// GET /api/patches
//
// Auth-required (any logged-in user). Returns the Star Citizen patch
// list with resolved [from, to) windows so the client can build
// per-patch UI (clear-history-by-patch dropdown, patch-aware filters)
// without duplicating the patch metadata.
//
// This is a non-admin sibling of /api/admin/patches — same payload
// shape, no admin check. Patch dates are public Star Citizen release
// info, but we keep it behind auth so anonymous traffic doesn't poll
// the endpoint and so the response stays consistent with the rest of
// the user's Ledger surface.

import { getRedis } from "./_lib/redis.js";
import { getSession } from "./_lib/session.js";
import { PATCHES, patchRange } from "./_lib/patches.js";

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

  const now = Date.now();
  const patches = PATCHES.map((p) => {
    const r = patchRange(p.version);
    return {
      version: p.version,
      startedAt: p.startedAt,
      from: r ? r.from : null,
      to: r ? r.to : null,
      isCurrent: r ? r.isCurrent : false,
      isReleased: Boolean(p.startedAt) && p.startedAt <= now,
    };
  });

  return res.status(200).json({ patches });
}
