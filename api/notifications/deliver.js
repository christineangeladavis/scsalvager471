// POST /api/notifications/deliver
//
// QStash invokes this endpoint at (approximately) the moment a refinery job
// completes. We verify the request actually came from QStash (HMAC signature),
// look up the user's prefs and the job, send a Discord DM, and mark the job
// as notified so we don't double-fire if QStash retries.
//
// Returns 200 in all "expected" non-delivery cases (job missing, user
// disabled DMs, etc.) so QStash treats them as terminal and doesn't retry.
// Returns 5xx only for transient infrastructure failures we want retried.

import { getRedis } from "../_lib/redis.js";
import { getPrefs } from "../_lib/prefs.js";
import { sendDirectMessage, explainDmFailure } from "../_lib/discordBot.js";
import { verifyQstashSignature } from "../_lib/qstash.js";
import { ledgerKey } from "../ledger.js";

// Disable Vercel's automatic body parsing so we can read the raw bytes for
// HMAC verification. (Parsed JSON would be re-stringified differently and
// fail the signature check.)
export const config = { api: { bodyParser: false } };

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function buildJobMessage(job) {
  // The refinery output for Construction Salvage / Pieces / Rubble is always
  // "Construction Material", regardless of which input was used. We report the
  // refined yield (job.yield) — the SCU the user actually picks up — not the
  // raw materialScu they originally fed in.
  // Format: "Your Refinery Job for {yield} SCU of Construction Material is ready for pickup at {location}."
  const yieldNum = Number(job.yield);
  const scu = Number.isFinite(yieldNum) && yieldNum > 0
    ? `${yieldNum.toLocaleString(undefined, { maximumFractionDigits: 2 })} SCU`
    : "your batch";
  const location = job.location || "your refinery";
  return `Your Refinery Job for ${scu} of Construction Material is ready for pickup at ${location}.`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Step 1: read raw body, verify QStash signature.
  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (e) {
    console.error("deliver: failed to read body:", e && e.message ? e.message : e);
    return res.status(400).json({ error: "Could not read body" });
  }

  const signature =
    req.headers["upstash-signature"] || req.headers["Upstash-Signature"];
  const isValid = await verifyQstashSignature({ signature, rawBody });
  if (!isValid) {
    console.warn("deliver: invalid or missing QStash signature");
    return res.status(401).json({ error: "Invalid signature" });
  }

  // Step 2: parse payload.
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    console.warn("deliver: payload not valid JSON");
    return res.status(400).json({ error: "Invalid payload" });
  }
  const { jobId, userId } = payload || {};
  if (!jobId || !userId) {
    return res.status(400).json({ error: "Missing jobId or userId" });
  }

  // Step 3: load Redis client.
  let redis;
  try {
    redis = getRedis();
  } catch (e) {
    console.error("deliver: Redis unavailable:", e.message);
    // Transient — let QStash retry.
    return res.status(503).json({ error: e.message });
  }

  // Step 4: load the user's ledger and find the target job.
  const key = ledgerKey(userId);
  let ledger;
  try {
    ledger = (await redis.get(key)) || { refineryJobs: [], sellOrders: [] };
  } catch (e) {
    console.error("deliver: ledger read failed:", e.message);
    return res.status(503).json({ error: "Storage error" });
  }

  const refineryJobs = Array.isArray(ledger.refineryJobs) ? ledger.refineryJobs : [];
  const jobIndex = refineryJobs.findIndex((j) => j && j.id === jobId);
  if (jobIndex === -1) {
    // Job was deleted before completion. Terminal: don't retry.
    return res.status(200).json({ ok: false, reason: "job-not-found" });
  }

  const job = refineryJobs[jobIndex];

  // Already notified — QStash double-delivery or manual re-publish. Skip.
  if (job.notifiedAt) {
    return res.status(200).json({ ok: false, reason: "already-notified" });
  }

  // Defensive: if the job was edited to complete later, the original QStash
  // callback may fire before our cancellation took effect (or cancellation
  // failed entirely). The new schedule will deliver at the correct time;
  // skip this stale callback rather than DM the user too early.
  // Allow a 60s grace window for clock skew.
  if (job.completesAt > Date.now() + 60 * 1000) {
    return res.status(200).json({ ok: false, reason: "stale-schedule" });
  }

  // Step 5: check user prefs.
  const prefs = await getPrefs(redis, userId);
  if (!prefs.discordNotifications || !prefs.notificationLinkedAt) {
    // User turned DMs off or disconnected after the job was scheduled.
    // Mark the job so we record the decision; don't retry.
    refineryJobs[jobIndex] = {
      ...job,
      notifiedAt: Date.now(),
      notificationStatus: "skipped",
    };
    try {
      await redis.set(key, { ...ledger, refineryJobs });
    } catch (e) {
      console.error("deliver: failed to mark job skipped:", e.message);
      // Even if the write fails, return 200 — the user explicitly disabled DMs.
    }
    return res.status(200).json({ ok: false, reason: "user-opted-out" });
  }

  // Step 6: send the DM.
  const message = buildJobMessage(job);
  const result = await sendDirectMessage(userId, message);

  // Step 7: record outcome on the job.
  const updatedJob = {
    ...job,
    notifiedAt: Date.now(),
    notificationStatus: result.ok ? "sent" : "failed",
  };
  refineryJobs[jobIndex] = updatedJob;
  try {
    await redis.set(key, { ...ledger, refineryJobs });
  } catch (e) {
    console.error("deliver: failed to mark job notified:", e.message);
    // The DM did go out (if result.ok). Don't return 5xx — that would cause
    // QStash to retry and re-DM the user. Eat the bookkeeping error.
  }

  if (result.ok) {
    return res.status(200).json({ ok: true });
  }

  const friendly = explainDmFailure(result);
  console.warn(
    "deliver: DM failed",
    JSON.stringify({ userId, jobId, status: result.status, code: result.code })
  );
  // DM rejected by Discord (e.g. user has DMs disabled). Terminal: don't retry.
  return res.status(200).json({
    ok: false,
    reason: "dm-rejected",
    error: friendly || result.message,
  });
}
