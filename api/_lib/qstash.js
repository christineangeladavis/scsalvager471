// Thin wrapper around @upstash/qstash for scheduling delayed HTTP callbacks.
// Used to fire a one-shot delivery request when a refinery job completes.

import { Client, Receiver } from "@upstash/qstash";

let cachedClient = null;
let cachedReceiver = null;

export function getQstashClient() {
  if (cachedClient) return cachedClient;
  const token = process.env.QSTASH_TOKEN;
  if (!token) {
    throw new Error(
      "QStash is not configured. Set QSTASH_TOKEN in your Vercel project's Environment Variables, then redeploy."
    );
  }
  // Optional: region-specific QStash accounts need an explicit base URL.
  // Find it in your Upstash Console under QStash → REST URL. If left unset,
  // the SDK uses the global default endpoint, which only works for accounts
  // provisioned in the global region.
  const baseUrl = process.env.QSTASH_URL || undefined;
  cachedClient = new Client({ token, baseUrl, enableTelemetry: false });
  return cachedClient;
}

export function getQstashReceiver() {
  if (cachedReceiver) return cachedReceiver;
  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!currentSigningKey || !nextSigningKey) {
    throw new Error(
      "QStash signing keys are not configured. Set QSTASH_CURRENT_SIGNING_KEY and QSTASH_NEXT_SIGNING_KEY in your Vercel project's Environment Variables, then redeploy."
    );
  }
  cachedReceiver = new Receiver({ currentSigningKey, nextSigningKey });
  return cachedReceiver;
}

/**
 * Schedule a one-shot HTTP callback to fire at (or near) `completesAt`.
 *
 * @param {object} args
 * @param {string} args.deliverUrl       - absolute URL of the deliver endpoint
 *                                          (e.g. "https://example.com/api/notifications/deliver")
 * @param {string} args.userId           - Discord user ID; included in payload
 * @param {string} args.jobId            - refinery job ID; included in payload + dedup key
 * @param {number} args.completesAt      - ms timestamp when the job finishes
 * @returns {Promise<{ ok: boolean, messageId?: string, error?: string }>}
 */
export async function scheduleJobCompletionCallback({
  deliverUrl,
  userId,
  jobId,
  completesAt,
}) {
  const now = Date.now();
  const delaySeconds = Math.max(0, Math.round((completesAt - now) / 1000));

  // Sanity guard: if completesAt is far in the past (>5 min), the job was
  // probably already completed before this code path ran. Skip rather than
  // scheduling an instant callback.
  if (now - completesAt > 5 * 60 * 1000) {
    return { ok: false, error: "completesAt too far in the past; skipped" };
  }

  try {
    const client = getQstashClient();
    const result = await client.publishJSON({
      url: deliverUrl,
      body: { jobId, userId },
      delay: delaySeconds,
      retries: 3,
      // Same job re-scheduled within QStash's dedup window is a no-op.
      // 15-min default window is fine; a job submitted multiple times is
      // a UI-level problem we don't need to handle here.
      // Note: QStash rejects deduplicationIds containing ':'; use '-' instead.
      deduplicationId: `notify-${jobId}`,
    });
    return { ok: true, messageId: result && result.messageId };
  } catch (e) {
    console.error("QStash schedule failed:", e && e.message ? e.message : e);
    return { ok: false, error: e && e.message ? e.message : "QStash error" };
  }
}

/**
 * Cancel a previously-scheduled QStash message before it fires.
 * Used when a user edits a refinery job's completion time so we can
 * publish a new schedule for the new completesAt without double-firing.
 *
 * @param {string} messageId - the messageId returned from publishJSON
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function cancelScheduledMessage(messageId) {
  if (!messageId) return { ok: false, error: "no messageId" };
  try {
    const client = getQstashClient();
    // The SDK exposes message deletion via client.messages.delete(id).
    await client.messages.delete(messageId);
    return { ok: true };
  } catch (e) {
    // Most likely failure: message already delivered (404). Treat as success
    // since there's nothing left to cancel anyway. Other failures (network,
    // invalid token) we log and report — the caller can decide whether to
    // proceed with publishing the replacement anyway.
    const msg = e && e.message ? e.message : "QStash error";
    if (/not found|404/i.test(msg)) {
      return { ok: true, error: "already-gone" };
    }
    console.warn("QStash cancel failed:", msg);
    return { ok: false, error: msg };
  }
}

/**
 * Verify an incoming request was actually sent by QStash. Reads the
 * `upstash-signature` header (case-insensitive) and verifies it against the
 * raw body using the configured signing keys.
 *
 * @param {string} signature - value of the upstash-signature header
 * @param {string} rawBody   - raw request body (NOT parsed JSON)
 * @returns {Promise<boolean>}
 */
export async function verifyQstashSignature({ signature, rawBody }) {
  if (!signature || rawBody === undefined || rawBody === null) return false;
  try {
    const receiver = getQstashReceiver();
    const isValid = await receiver.verify({
      signature,
      body: rawBody,
      // Tolerate small clock skew between QStash and Vercel.
      clockTolerance: 30,
    });
    return Boolean(isValid);
  } catch (e) {
    console.warn("QStash signature verify threw:", e && e.message ? e.message : e);
    return false;
  }
}
