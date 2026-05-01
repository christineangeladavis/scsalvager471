// GET /api/admin/active-refineries
//
// Admin-only. Returns every refinery job AND every sell order submitted
// in the last 7 days (excluding soft-deleted entries) across every user
// who has ever logged in to the site, grouped by Discord display name.
// The endpoint name is historical — originally only returned in-flight
// jobs; it now backs the broader "Recent Activity" admin view.
//
// Auth model:
//   - Caller must be logged in.
//   - isAdminSession(session) must be true (env var or fallback ID list).
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
import { isAdminSession } from "../_lib/admin.js";
import { listUserIds, getUserMeta } from "../_lib/userIndex.js";
import { getPrefs } from "../_lib/prefs.js";
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

  if (!isAdminSession(session)) {
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
    const jobs = allJobs
      .filter((j) =>
        j &&
        Number.isFinite(j.submittedAt) &&
        j.submittedAt >= cutoff &&
        !j.deletedAt
      )
      .map((j) => ({
        id: j.id,
        material: j.material,
        materialScu: j.materialScu,
        location: j.location,
        method: j.method,
        submittedAt: j.submittedAt,
        completesAt: j.completesAt,
        pickedUpAt: j.pickedUpAt || null,
        notificationStatus: j.notificationStatus || null,
      }));

    const allSales = Array.isArray(ledger.sellOrders) ? ledger.sellOrders : [];
    const sales = allSales
      .filter((o) =>
        o &&
        Number.isFinite(o.submittedAt) &&
        o.submittedAt >= cutoff &&
        !o.deletedAt
      )
      .map((o) => ({
        id: o.id,
        material: o.material,
        scu: o.scu,
        aUEC: o.aUEC,
        location: o.location,
        playerName: o.playerName || "",
        submittedAt: o.submittedAt,
      }));

    // Active mission contracts come from prefs, not the ledger.
    // Pull them so the admin's 7-day view can surface in-flight
    // contracts even when the user hasn't logged any refinery /
    // sales activity in the same window.
    let activeContracts = [];
    try {
      const prefs = await getPrefs(redis, userId);
      activeContracts = Array.isArray(prefs?.activeContracts)
        ? prefs.activeContracts
            .filter((c) => c && c.missionId)
            .map((c) => ({
              missionId: c.missionId,
              name: c.name,
              reward: c.reward,
              buyIn: c.buyIn,
              acceptedAt: c.acceptedAt,
            }))
        : [];
    } catch (e) {
      activeContracts = [];
    }

    if (jobs.length === 0 && sales.length === 0 && activeContracts.length === 0) continue;

    const meta = await getUserMeta(redis, userId);
    users.push({
      userId,
      username: (meta && meta.username) || "Unknown",
      jobs,
      sales,
      activeContracts,
    });
  }

  // Sort users by their most recent event so the freshest activity bubbles
  // to the top of the table. Active-contract acceptedAt timestamps count
  // toward "most recent event" so users with only an in-flight contract
  // still rank by when they accepted it.
  users.sort((a, b) => {
    const latest = (u) => {
      const all = [
        ...u.jobs,
        ...u.sales,
        ...(u.activeContracts || []).map((c) => ({ submittedAt: c.acceptedAt })),
      ].map((e) => e.submittedAt);
      return all.length ? Math.max(...all) : 0;
    };
    return latest(b) - latest(a);
  });

  return res.status(200).json({
    fetchedAt: Date.now(),
    users,
  });
}
