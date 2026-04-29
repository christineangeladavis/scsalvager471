// GET /api/stats
//
// Auth: any logged-in user. Returns site-wide aggregate stats across
// every indexed user's ledger plus a leaderboard of the top 5 salvagers
// by total SCU refined.
//
// Aggregation rules:
//   - SCU refined: sum of `yield` over completed (pickedUpAt set) and
//     non-deleted refinery jobs.
//   - Refinery fees: sum of `cost` over non-deleted refinery jobs
//     (whether or not the job was picked up — fees were paid up front).
//   - Profit: sum of `aUEC` over non-deleted sell orders. (Gross sale
//     proceeds — the user-facing label is "profit" since that's what
//     they walked away with after subtracting any fees they paid.)
//   - Most-used refinery location: the refinery location that appears
//     most often across non-deleted refinery jobs (counts every job,
//     picked up or not). Sell-order locations don't count here.
//   - Most-used method: the refinery method that appears most often
//     across non-deleted refinery jobs (counts every job, picked up or
//     not — picking a method is a decision that already happened).
//   - Per-material refined totals (Construction Salvage / Pieces /
//     Rubble): summed `yield` over completed non-deleted jobs filtered
//     by material. These are headline cards on the Statistics tab so
//     they're returned even when zero (UI prefers a "0 SCU" card over
//     a blank one).
//
// Response shape:
//   {
//     fetchedAt: <ms>,
//     totalScuRefined: number,
//     totalProfitAuec: number,
//     totalRefineryFeesAuec: number,
//     mostUsedRefineryLocation: { name: string, count: number } | null,
//     mostUsedMethod: { name: string, count: number } | null,
//     refinedConstructionSalvage: number,
//     refinedConstructionPieces:  number,
//     refinedConstructionRubble:  number,
//     topSalvagers: [
//       { username: string, scuRefined: number, profitAuec: number, verified: boolean }
//     ]
//   }
//
// `verified` is true only when the user has set an RSI handle AND that
// handle has been confirmed via the RSI Short-Bio token check. The flag
// always reads false when we're falling back to a Discord username.

import { getRedis } from "./_lib/redis.js";
import { getSession } from "./_lib/session.js";
import { listUserIds, getUserMeta } from "./_lib/userIndex.js";
import { getPrefs } from "./_lib/prefs.js";
import { ledgerKey } from "./ledger.js";

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

  const userIds = await listUserIds(redis);
  let totalScuRefined = 0;
  let totalProfitAuec = 0;
  let totalRefineryFeesAuec = 0;
  // Headline per-material totals for the three input salvage classes.
  // These are the same SCU as the materialScu Map below, just pulled out
  // explicitly so the response always carries them (even at 0).
  let refinedConstructionSalvage = 0;
  let refinedConstructionPieces = 0;
  let refinedConstructionRubble = 0;
  const refineryLocationCounts = new Map();
  const methodCounts = new Map();
  const perUser = [];

  for (const userId of userIds) {
    let ledger;
    try {
      ledger = (await redis.get(ledgerKey(userId))) || {};
    } catch {
      continue;
    }
    const jobs = Array.isArray(ledger.refineryJobs) ? ledger.refineryJobs : [];
    const orders = Array.isArray(ledger.sellOrders) ? ledger.sellOrders : [];

    let userScu = 0;
    let userFees = 0;
    let userProfit = 0;

    for (const j of jobs) {
      if (!j || j.deletedAt) continue;
      if (Number.isFinite(j.cost)) userFees += Number(j.cost);
      if (j.pickedUpAt && Number.isFinite(j.yield)) userScu += Number(j.yield);
      if (j.location) {
        refineryLocationCounts.set(
          j.location,
          (refineryLocationCounts.get(j.location) || 0) + 1
        );
      }
      if (j.method) {
        methodCounts.set(j.method, (methodCounts.get(j.method) || 0) + 1);
      }
      // Per-material refined totals only count when the job actually
      // completed — matches the SCU-refined definition above.
      if (j.pickedUpAt && j.material && Number.isFinite(j.yield)) {
        const yieldScu = Number(j.yield);
        if (j.material === "Construction Salvage") {
          refinedConstructionSalvage += yieldScu;
        } else if (j.material === "Construction Pieces") {
          refinedConstructionPieces += yieldScu;
        } else if (j.material === "Construction Rubble") {
          refinedConstructionRubble += yieldScu;
        }
      }
    }
    for (const o of orders) {
      if (!o || o.deletedAt) continue;
      if (Number.isFinite(o.aUEC)) userProfit += Number(o.aUEC);
      // Sell-order locations are intentionally NOT counted toward the
      // "Refinery Most Used" stat — that card is refinery-only.
    }

    totalScuRefined += userScu;
    totalRefineryFeesAuec += userFees;
    totalProfitAuec += userProfit;

    // Top Salvagers leaderboard ranks strictly on SCU refined, so a
    // user only qualifies if they actually refined material. Profit-
    // only ledger activity (e.g. mission contract settlements) does
    // not contribute to ranking.
    if (userScu > 0) {
      const meta = await getUserMeta(redis, userId);
      const prefs = await getPrefs(redis, userId);
      // Display name priority:
      //   1. Verified RSI handle  (load-bearing — proves identity)
      //   2. User-set displayName (free-form override for users who
      //      haven't linked an RSI profile yet)
      //   3. Discord username      (default fallback)
      // The verified RSI handle wins over displayName so a successful
      // verify always reflects the user's in-game identity, regardless
      // of any custom name they had set previously.
      const rsiHandle = prefs && typeof prefs.rsiHandle === "string"
        ? prefs.rsiHandle.trim()
        : "";
      const verified = Boolean(rsiHandle && prefs && prefs.rsiHandleVerified);
      const customName = prefs && typeof prefs.displayName === "string"
        ? prefs.displayName.trim()
        : "";
      const fallbackName = customName || (meta && meta.username) || "Unknown";
      const displayName = verified ? rsiHandle : fallbackName;
      // Include the uploaded avatar (if any) so the leaderboard can
      // render the user's chosen face next to their name. Empty
      // string means "fall back to the Discord avatar" — handled
      // client-side, since stats doesn't know the Discord cdn url
      // for users other than the caller.
      const avatarDataUrl =
        prefs && typeof prefs.avatarDataUrl === "string"
          ? prefs.avatarDataUrl
          : "";
      perUser.push({
        username: displayName,
        scuRefined: userScu,
        profitAuec: userProfit,
        verified,
        avatarDataUrl,
      });
    }
  }

  let mostUsedRefineryLocation = null;
  for (const [name, count] of refineryLocationCounts) {
    if (!mostUsedRefineryLocation || count > mostUsedRefineryLocation.count) {
      mostUsedRefineryLocation = { name, count };
    }
  }

  let mostUsedMethod = null;
  for (const [name, count] of methodCounts) {
    if (!mostUsedMethod || count > mostUsedMethod.count) {
      mostUsedMethod = { name, count };
    }
  }

  const topSalvagers = perUser
    .sort((a, b) => b.scuRefined - a.scuRefined)
    .slice(0, 5);

  return res.status(200).json({
    fetchedAt: Date.now(),
    totalScuRefined: Math.round(totalScuRefined * 100) / 100,
    totalProfitAuec: Math.round(totalProfitAuec),
    totalRefineryFeesAuec: Math.round(totalRefineryFeesAuec),
    mostUsedRefineryLocation,
    mostUsedMethod,
    refinedConstructionSalvage: Math.round(refinedConstructionSalvage * 100) / 100,
    refinedConstructionPieces: Math.round(refinedConstructionPieces * 100) / 100,
    refinedConstructionRubble: Math.round(refinedConstructionRubble * 100) / 100,
    topSalvagers: topSalvagers.map((u) => ({
      username: u.username,
      scuRefined: Math.round(u.scuRefined * 100) / 100,
      profitAuec: Math.round(u.profitAuec),
      verified: Boolean(u.verified),
      avatarDataUrl: u.avatarDataUrl || "",
    })),
  });
}
