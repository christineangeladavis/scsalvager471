// GET /api/admin/active-refineries
//
// Admin-only. Returns every active refinery job (not yet picked up,
// submittedAt within the last 7 days) across every user who has ever
// logged in to the site, grouped by Discord display name.
//
// Auth model:
//   - Caller must be logged in.
//   - Caller's session.userId must equal process.env.ADMIN_DISCORD_ID.
//
// Response shape:
//   {
//     fetchedAt: <ms>,
//     users: [
//       {
//         userId: "...",
//         username: "...",
//         jobs: [
//           { id, material, materialScu, location, method,
//             submittedAt, completesAt, notificationStatus }
//         ]
//       },
//       ...
//     ]
//   }
//
// Storage availability is best-effort: a Redis outage returns 503 so the
// client can show a clear "try again" rather than empty rows.

import { getRedis } from "../_lib/redis.js";
import { getSession } from "../_lib/session.js";
import { listUserIds, getUserMeta } from "../_lib/userIndex.js";
import { ledgerKey } from "../ledger.js";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

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

  const cutoff = Date.now() - SEVEN_DAYS_MS;
  const userIds = await listUserIds(redis);

  const users = [];
  for (const userId of userIds) {
    let ledger;
    try {
      ledger = (await redis.get(ledgerKey(userId))) || {};
    } catch (e) {
      console.error(
        "active-refineries: ledger read failed for",
        userId,
        e && e.message ? e.message : e
      );
      continue;
    }

    const allJobs = Array.isArray(ledger.refineryJobs) ? ledger.refineryJobs : [];
    const activeJobs = allJobs
      .filter((j) =>
        j &&
        Number.isFinite(j.submittedAt) &&
        j.submittedAt >= cutoff &&
        !j.pickedUpAt
      )
      .map((j) => ({
        id: j.id,
        material: j.material,
        materialScu: j.materialScu,
        location: j.location,
        method: j.method,
        submittedAt: j.submittedAt,
        completesAt: j.completesAt,
        notificationStatus: j.notificationStatus || null,
      }));

    if (activeJobs.length === 0) continue;

    const meta = await getUserMeta(redis, userId);
    users.push({
      userId,
      username: (meta && meta.username) || "Unknown",
      jobs: activeJobs,
    });
  }

  // Sort users by their earliest in-progress job so the most-recent activity
  // is easy to find at the top.
  users.sort((a, b) => {
    const aMin = Math.min(...a.jobs.map((j) => j.completesAt));
    const bMin = Math.min(...b.jobs.map((j) => j.completesAt));
    return aMin - bMin;
  });

  return res.status(200).json({
    fetchedAt: Date.now(),
    users,
  });
}
