// GET  /api/ledger         — returns { refineryJobs, sellOrders } for the logged-in user
// POST /api/ledger         — replaces the ledger with the request body (full snapshot).
//                            For new refinery jobs, schedules a one-shot QStash callback
//                            that fires at completesAt and DMs the user via Discord.
// Returns 401 if not logged in.

import { getRedis } from "./_lib/redis.js";
import { getSession } from "./_lib/session.js";
import { getPrefs } from "./_lib/prefs.js";
import { scheduleJobCompletionCallback } from "./_lib/qstash.js";
import { getOrigin } from "./_lib/discord.js";

const MAX_REFINERY_JOBS = 500;
const MAX_SELL_ORDERS = 500;

function ledgerKey(userId) {
  return `ledger:${userId}`;
}

function sanitizeRefineryJob(j) {
  if (!j || typeof j !== "object") return null;
  const out = {
    id: String(j.id || "").slice(0, 80),
    material: String(j.material || "").slice(0, 80),
    location: j.location ? String(j.location).slice(0, 80) : undefined,
    method: j.method ? String(j.method).slice(0, 80) : undefined,
    materialScu: Number.isFinite(Number(j.materialScu)) ? Number(j.materialScu) : undefined,
    yield: Number(j.yield),
    cost: Number(j.cost),
    timeMinutes: Number(j.timeMinutes),
    submittedAt: Number(j.submittedAt),
    completesAt: Number(j.completesAt),
    pickedUpAt: j.pickedUpAt ? Number(j.pickedUpAt) : null,
    // Notification bookkeeping (set by the deliver endpoint, never by the client).
    notifiedAt: j.notifiedAt ? Number(j.notifiedAt) : null,
    notificationStatus: j.notificationStatus
      ? String(j.notificationStatus).slice(0, 32)
      : null,
  };
  if (!out.id || !out.material) return null;
  if (!Number.isFinite(out.yield) || !Number.isFinite(out.cost)) return null;
  if (!Number.isFinite(out.submittedAt) || !Number.isFinite(out.completesAt)) return null;
  if (out.pickedUpAt !== null && !Number.isFinite(out.pickedUpAt)) out.pickedUpAt = null;
  if (out.notifiedAt !== null && !Number.isFinite(out.notifiedAt)) out.notifiedAt = null;
  if (out.location === undefined) delete out.location;
  if (out.method === undefined) delete out.method;
  if (out.materialScu === undefined) delete out.materialScu;
  return out;
}

function sanitizeSellOrder(o) {
  if (!o || typeof o !== "object") return null;
  const out = {
    id: String(o.id || "").slice(0, 80),
    scu: Number(o.scu),
    location: String(o.location || "").slice(0, 120),
    aUEC: Number(o.aUEC),
    submittedAt: Number(o.submittedAt),
  };
  if (!out.id || !out.location) return null;
  if (!Number.isFinite(out.scu) || !Number.isFinite(out.aUEC)) return null;
  if (!Number.isFinite(out.submittedAt)) return null;
  return out;
}

export default async function handler(req, res) {
  let redis;
  try {
    redis = getRedis();
  } catch (e) {
    console.error("Ledger — Redis unavailable:", e.message);
    return res.status(503).json({ error: e.message });
  }

  const session = await getSession(req, redis);
  if (!session) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const key = ledgerKey(session.userId);
  res.setHeader("cache-control", "private, no-store");

  if (req.method === "GET") {
    try {
      const data = (await redis.get(key)) || { refineryJobs: [], sellOrders: [] };
      return res.status(200).json({
        refineryJobs: Array.isArray(data.refineryJobs) ? data.refineryJobs : [],
        sellOrders: Array.isArray(data.sellOrders) ? data.sellOrders : [],
      });
    } catch (e) {
      console.error("GET /api/ledger failed:", e && e.message ? e.message : e);
      return res.status(500).json({ error: "Could not load ledger" });
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

    const refineryJobsRaw = Array.isArray(body.refineryJobs) ? body.refineryJobs : [];
    const sellOrdersRaw = Array.isArray(body.sellOrders) ? body.sellOrders : [];

    const refineryJobs = refineryJobsRaw
      .slice(-MAX_REFINERY_JOBS)
      .map(sanitizeRefineryJob)
      .filter(Boolean);
    const sellOrders = sellOrdersRaw.slice(-MAX_SELL_ORDERS).map(sanitizeSellOrder).filter(Boolean);

    // Compare incoming jobs to what was previously stored, so we only schedule
    // notifications for *newly added* jobs. Existing jobs (edited or idle) and
    // jobs that pre-date this feature are left alone.
    let previousJobIds = new Set();
    try {
      const existing = await redis.get(key);
      if (existing && Array.isArray(existing.refineryJobs)) {
        for (const j of existing.refineryJobs) {
          if (j && j.id) previousJobIds.add(j.id);
        }
      }
    } catch (e) {
      // If we can't read the old set we fall back to "schedule nothing this
      // round", erring on the side of dropped notifications rather than
      // duplicates. A future submit will pick up future jobs.
      console.warn("Ledger POST: could not read previous jobs:", e && e.message ? e.message : e);
      previousJobIds = null;
    }

    try {
      await redis.set(key, { refineryJobs, sellOrders });
    } catch (e) {
      console.error("POST /api/ledger failed:", e && e.message ? e.message : e);
      return res.status(500).json({ error: "Could not save ledger" });
    }

    // Schedule notifications. Errors here do NOT fail the save — the user's
    // ledger is already persisted. Worst case is no DM for one job.
    if (previousJobIds) {
      try {
        const prefs = await getPrefs(redis, session.userId);
        const userOptedIn = prefs.discordNotifications && prefs.notificationLinkedAt;
        console.log(
          "Ledger POST: scheduling check",
          JSON.stringify({
            userId: session.userId,
            discordNotifications: prefs.discordNotifications,
            notificationLinkedAt: prefs.notificationLinkedAt,
            userOptedIn: Boolean(userOptedIn),
            incomingJobs: refineryJobs.length,
            previousJobCount: previousJobIds.size,
          })
        );
        if (userOptedIn) {
          const deliverUrl = `${getOrigin(req)}/api/notifications/deliver`;
          const now = Date.now();
          let scheduledCount = 0;
          let skippedExisting = 0;
          let skippedPast = 0;
          let skippedNotified = 0;
          for (const job of refineryJobs) {
            const isNew = !previousJobIds.has(job.id);
            const inFuture = job.completesAt > now;
            const notYetSent = !job.notifiedAt;
            if (!isNew) { skippedExisting++; continue; }
            if (!inFuture) { skippedPast++; continue; }
            if (!notYetSent) { skippedNotified++; continue; }
            scheduledCount++;
            scheduleJobCompletionCallback({
              deliverUrl,
              userId: session.userId,
              jobId: job.id,
              completesAt: job.completesAt,
            })
              .then((result) => {
                if (result && result.ok) {
                  console.log(
                    "Ledger POST: scheduled notification",
                    JSON.stringify({ jobId: job.id, messageId: result.messageId, completesAt: job.completesAt })
                  );
                } else {
                  console.warn(
                    "Ledger POST: schedule returned not-ok for job",
                    job.id,
                    result && result.error
                  );
                }
              })
              .catch((e) => {
                console.warn(
                  "Ledger POST: schedule failed for job",
                  job.id,
                  e && e.message ? e.message : e
                );
              });
          }
          console.log(
            "Ledger POST: scheduling summary",
            JSON.stringify({ scheduledCount, skippedExisting, skippedPast, skippedNotified, deliverUrl })
          );
        } else {
          console.log("Ledger POST: user not opted in, no notifications scheduled");
        }
      } catch (e) {
        console.warn("Ledger POST: notification scheduling skipped:", e && e.message ? e.message : e);
      }
    } else {
      console.log("Ledger POST: previousJobIds is null, skipping all scheduling this round");
    }

    return res.status(200).json({
      ok: true,
      counts: { refineryJobs: refineryJobs.length, sellOrders: sellOrders.length },
    });
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Method not allowed" });
}
