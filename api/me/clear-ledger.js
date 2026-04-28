// POST /api/me/clear-ledger
//
// Self-service: lets a logged-in user wipe their own ledger when a new
// Star Citizen patch drops, so they start the new cycle clean. Tightly
// gated:
//
//   1. Caller must be authenticated.
//   2. Body must include `{ confirm: "CLEAR_LEDGER" }`.
//   3. Today (UTC) must be the same calendar date as the current
//      patch's `startedAt`. Any other day → 403.
//   4. The user must not have already used this for the current patch
//      cycle (`prefs.lastPatchClearAt < currentPatch.startedAt`).
//
// On success:
//   - All refinery jobs + sell orders get `deletedAt` stamped (same
//     soft-delete used by per-entry Discard).
//   - In-flight QStash notification schedules are cancelled.
//   - `prefs.lastPatchClearAt` is set to now so the gate denies a
//     second use this cycle.
//
// Response:
//   200 { ok: true, jobsCleared, salesCleared, clearedAt, patchVersion }
//   400 { error: "Missing or invalid confirmation" }
//   401 { error: "Not authenticated" }
//   403 { error: "Patch reset is only available on patch drop day" }
//   403 { error: "Already used for this patch cycle" }
//   503 { error: "Storage unavailable" }

import { getRedis } from "../_lib/redis.js";
import { getSession } from "../_lib/session.js";
import { getPrefs, updatePrefs } from "../_lib/prefs.js";
import { currentPatch, isPatchDropDay } from "../_lib/patches.js";
import { softClearLedger } from "../_lib/ledgerOps.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  res.setHeader("cache-control", "private, no-store");

  let redis;
  try {
    redis = getRedis();
  } catch {
    return res.status(503).json({ error: "Storage unavailable" });
  }

  const session = await getSession(req, redis);
  if (!session) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  const userId = String(session.userId || "");
  if (!userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = null;
    }
  }
  if (!body || typeof body !== "object" || body.confirm !== "CLEAR_LEDGER") {
    return res.status(400).json({ error: "Missing or invalid confirmation" });
  }

  const now = Date.now();
  const cp = currentPatch(now);
  if (!cp || !isPatchDropDay(now)) {
    return res.status(403).json({
      error: "Patch reset is only available on patch drop day",
    });
  }

  const prefs = await getPrefs(redis, userId);
  if (
    Number.isFinite(Number(prefs.lastPatchClearAt)) &&
    Number(prefs.lastPatchClearAt) >= cp.startedAt
  ) {
    return res.status(403).json({
      error: "Already used for this patch cycle",
    });
  }

  const { jobsCleared, salesCleared } = await softClearLedger(redis, userId);

  // Stamp the prefs so the gate denies a second use this cycle.
  try {
    await updatePrefs(redis, userId, { lastPatchClearAt: now });
  } catch (e) {
    console.warn(
      "clear-ledger: prefs update failed:",
      e && e.message ? e.message : e
    );
    // Do NOT undo the soft-delete — the user's intent was already
    // satisfied. The next call will be denied by the cycle guard once
    // the prefs catch up; a second call before then is idempotent at
    // the soft-delete layer (no double-deletion side effects).
  }

  return res.status(200).json({
    ok: true,
    jobsCleared,
    salesCleared,
    clearedAt: now,
    patchVersion: cp.version,
  });
}
