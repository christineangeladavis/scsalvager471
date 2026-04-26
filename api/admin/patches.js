// GET /api/admin/patches
// Admin-only. Returns the patch list with resolved [from, to) windows
// so the client export UI can populate its dropdown without duplicating
// the patch metadata.

import { getRedis } from "../_lib/redis.js";
import { getSession } from "../_lib/session.js";
import { PATCHES, patchRange } from "../_lib/patches.js";

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
  const adminId = process.env.ADMIN_DISCORD_ID || "";
  if (!adminId || String(session.userId) !== String(adminId)) {
    return res.status(403).json({ error: "Admin access required" });
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
      // Released = startedAt is set AND not in the future. Patches with a
      // future startedAt are surfaced in the dropdown (so admins see what's
      // coming) but disabled.
      isReleased: Boolean(p.startedAt) && p.startedAt <= now,
    };
  });

  return res.status(200).json({ patches });
}
