// Shared ledger operations used by multiple API surfaces (admin
// clear-user-ledger + self-service patch clear).
//
// "Soft clear" matches the existing per-entry Discard pattern: every
// refinery job and sell order in the user's ledger gets `deletedAt`
// stamped, leaving the record intact for admin audit. Live notification
// schedules are cancelled so QStash doesn't deliver completion DMs for
// jobs the user no longer cares about.

import {
  ledgerKey,
  sanitizeRefineryJob,
  sanitizeSellOrder,
} from "../ledger.js";
import { cancelScheduledMessage } from "./qstash.js";

// Whitelist of fields admins can edit on a refinery job. Server-
// managed bookkeeping (notification ids/status, deletedAt, id) is
// deliberately excluded.
const JOB_EDITABLE_FIELDS = [
  "material",
  "materialScu",
  "location",
  "method",
  "yield",
  "cost",
  "timeMinutes",
  "submittedAt",
  "completesAt",
  "pickedUpAt",
];

// Whitelist of fields admins can edit on a sell order.
const SALE_EDITABLE_FIELDS = [
  "material",
  "scu",
  "location",
  "playerName",
  "aUEC",
  "submittedAt",
];

/**
 * Soft-deletes entries in a user's ledger. Returns
 * `{ jobsCleared, salesCleared }` so callers can surface counts.
 *
 * - Sets `deletedAt: now` on every refinery job and sell order that
 *   wasn't already soft-deleted AND whose `submittedAt` falls in the
 *   optional window. Window is `[from, to)`. When `from`/`to` are not
 *   supplied, every entry is in scope (legacy behavior).
 * - Cancels QStash messages for in-flight refinery jobs that hadn't
 *   yet fired (best-effort — failures are logged, not raised).
 *
 * Storage layout matches `api/ledger.js`: a single Redis key
 * `ledger:{userId}` holding `{ refineryJobs, sellOrders }`.
 *
 * Use cases:
 *   - `softClearLedger(redis, userId)` — wipe everything (admin-all
 *     clear, self-service patch reset on cycle start).
 *   - `softClearLedger(redis, userId, { from, to })` — wipe one patch
 *     window (admin per-patch clear).
 */
export async function softClearLedger(redis, userId, opts = {}) {
  if (!redis || !userId) {
    return { jobsCleared: 0, salesCleared: 0 };
  }
  const fromMs = Number.isFinite(Number(opts.from)) ? Number(opts.from) : null;
  const toMs = Number.isFinite(Number(opts.to)) ? Number(opts.to) : null;
  // If both bounds are present and the window is empty/inverted, no-op.
  if (fromMs !== null && toMs !== null && toMs <= fromMs) {
    return { jobsCleared: 0, salesCleared: 0 };
  }
  const inWindow = (ts) => {
    if (!Number.isFinite(Number(ts))) return false;
    const t = Number(ts);
    if (fromMs !== null && t < fromMs) return false;
    if (toMs !== null && t >= toMs) return false;
    return true;
  };
  const key = ledgerKey(userId);
  let data;
  try {
    data = await redis.get(key);
  } catch (e) {
    console.error(
      "softClearLedger: redis read failed:",
      e && e.message ? e.message : e
    );
    return { jobsCleared: 0, salesCleared: 0 };
  }
  if (!data || typeof data !== "object") {
    return { jobsCleared: 0, salesCleared: 0 };
  }
  const now = Date.now();
  const jobs = Array.isArray(data.refineryJobs) ? data.refineryJobs : [];
  const sales = Array.isArray(data.sellOrders) ? data.sellOrders : [];

  // Collect QStash messageIds to cancel for in-flight jobs (not yet
  // delivered, not yet picked up, not yet soft-deleted).
  const cancelMessageIds = [];
  let jobsCleared = 0;
  const updatedJobs = jobs.map((j) => {
    if (!j || typeof j !== "object") return j;
    if (j.deletedAt) return j; // already soft-deleted
    if (!inWindow(j.submittedAt)) return j; // outside requested window
    jobsCleared += 1;
    if (
      j.notificationMessageId &&
      !j.notifiedAt &&
      typeof j.completesAt === "number" &&
      j.completesAt > now
    ) {
      cancelMessageIds.push(j.notificationMessageId);
    }
    return { ...j, deletedAt: now };
  });

  let salesCleared = 0;
  const updatedSales = sales.map((s) => {
    if (!s || typeof s !== "object") return s;
    if (s.deletedAt) return s;
    if (!inWindow(s.submittedAt)) return s;
    salesCleared += 1;
    return { ...s, deletedAt: now };
  });

  try {
    await redis.set(key, {
      refineryJobs: updatedJobs,
      sellOrders: updatedSales,
    });
  } catch (e) {
    console.error(
      "softClearLedger: redis write failed:",
      e && e.message ? e.message : e
    );
    return { jobsCleared: 0, salesCleared: 0 };
  }

  // Cancel scheduled DMs in parallel; never raise.
  if (cancelMessageIds.length > 0) {
    await Promise.all(
      cancelMessageIds.map((mid) =>
        cancelScheduledMessage(mid).catch((e) => {
          console.warn(
            "softClearLedger: cancel failed for messageId",
            mid,
            e && e.message ? e.message : e
          );
        })
      )
    );
  }

  return { jobsCleared, salesCleared };
}

/**
 * Soft-deletes a single refinery job or sell order belonging to the
 * target user. Returns `{ deleted: boolean }`. Used by the admin
 * per-row delete action.
 *
 * `kind` must be either "job" or "sale". `entryId` is matched against
 * the entry's `id` field. No-ops (still returns ok) when the entry is
 * already soft-deleted or no longer exists — admin UIs can fire the
 * delete and refresh without coordinating local state vs server state.
 */
export async function softDeleteLedgerEntry(redis, userId, kind, entryId) {
  if (!redis || !userId || !entryId) return { deleted: false };
  if (kind !== "job" && kind !== "sale") return { deleted: false };
  const key = ledgerKey(userId);
  let data;
  try {
    data = await redis.get(key);
  } catch (e) {
    console.error(
      "softDeleteLedgerEntry: redis read failed:",
      e && e.message ? e.message : e
    );
    return { deleted: false };
  }
  if (!data || typeof data !== "object") {
    return { deleted: false };
  }
  const now = Date.now();
  const refineryJobs = Array.isArray(data.refineryJobs) ? data.refineryJobs : [];
  const sellOrders = Array.isArray(data.sellOrders) ? data.sellOrders : [];

  let deleted = false;
  let cancelMessageId = null;

  const updatedJobs =
    kind === "job"
      ? refineryJobs.map((j) => {
          if (!j || typeof j !== "object" || j.id !== entryId || j.deletedAt) {
            return j;
          }
          deleted = true;
          if (
            j.notificationMessageId &&
            !j.notifiedAt &&
            typeof j.completesAt === "number" &&
            j.completesAt > now
          ) {
            cancelMessageId = j.notificationMessageId;
          }
          return { ...j, deletedAt: now };
        })
      : refineryJobs;

  const updatedSales =
    kind === "sale"
      ? sellOrders.map((s) => {
          if (!s || typeof s !== "object" || s.id !== entryId || s.deletedAt) {
            return s;
          }
          deleted = true;
          return { ...s, deletedAt: now };
        })
      : sellOrders;

  if (!deleted) {
    return { deleted: false };
  }

  try {
    await redis.set(key, {
      refineryJobs: updatedJobs,
      sellOrders: updatedSales,
    });
  } catch (e) {
    console.error(
      "softDeleteLedgerEntry: redis write failed:",
      e && e.message ? e.message : e
    );
    return { deleted: false };
  }

  if (cancelMessageId) {
    try {
      await cancelScheduledMessage(cancelMessageId);
    } catch (e) {
      console.warn(
        "softDeleteLedgerEntry: cancel failed for messageId",
        cancelMessageId,
        e && e.message ? e.message : e
      );
    }
  }

  return { deleted: true };
}

/**
 * Apply a partial update to a single refinery job or sell order.
 * Returns `{ updated: boolean, entry: object|null }`.
 *
 * - `kind` must be "job" or "sale".
 * - Only fields in the editable whitelist are taken from `patch`;
 *   anything else is dropped silently.
 * - The merged entry is fed through the matching sanitize* helper so
 *   numeric coercion and length caps stay in sync with /api/ledger.js.
 * - Refuses to edit a soft-deleted entry (returns updated:false).
 * - Notification rescheduling is **not** performed here. If the admin
 *   changes `completesAt`, the client is responsible for re-saving the
 *   ledger via the normal POST /api/ledger path if a fresh DM schedule
 *   is required. In practice admin edits target historical entries and
 *   do not need a new DM.
 */
export async function editLedgerEntry(redis, userId, kind, entryId, patch) {
  if (!redis || !userId || !entryId) return { updated: false, entry: null };
  if (kind !== "job" && kind !== "sale") return { updated: false, entry: null };
  if (!patch || typeof patch !== "object") {
    return { updated: false, entry: null };
  }
  const key = ledgerKey(userId);
  let data;
  try {
    data = await redis.get(key);
  } catch (e) {
    console.error(
      "editLedgerEntry: redis read failed:",
      e && e.message ? e.message : e
    );
    return { updated: false, entry: null };
  }
  if (!data || typeof data !== "object") {
    return { updated: false, entry: null };
  }
  const refineryJobs = Array.isArray(data.refineryJobs) ? data.refineryJobs : [];
  const sellOrders = Array.isArray(data.sellOrders) ? data.sellOrders : [];

  const whitelist = kind === "job" ? JOB_EDITABLE_FIELDS : SALE_EDITABLE_FIELDS;
  const allowed = {};
  for (const field of whitelist) {
    if (field in patch) {
      allowed[field] = patch[field];
    }
  }
  if (Object.keys(allowed).length === 0) {
    return { updated: false, entry: null };
  }

  let updatedEntry = null;
  const list = kind === "job" ? refineryJobs : sellOrders;
  const sanitize = kind === "job" ? sanitizeRefineryJob : sanitizeSellOrder;

  const updatedList = list.map((entry) => {
    if (!entry || typeof entry !== "object") return entry;
    if (entry.id !== entryId) return entry;
    if (entry.deletedAt) return entry; // refuse to edit soft-deleted
    const merged = { ...entry, ...allowed };
    const cleaned = sanitize(merged);
    if (!cleaned) return entry; // sanitize rejected — leave original alone
    // Preserve fields sanitize doesn't carry through (e.g.
    // notificationMessageId on jobs).
    const final = { ...entry, ...cleaned };
    updatedEntry = final;
    return final;
  });

  if (!updatedEntry) {
    return { updated: false, entry: null };
  }

  try {
    await redis.set(key, {
      refineryJobs: kind === "job" ? updatedList : refineryJobs,
      sellOrders: kind === "sale" ? updatedList : sellOrders,
    });
  } catch (e) {
    console.error(
      "editLedgerEntry: redis write failed:",
      e && e.message ? e.message : e
    );
    return { updated: false, entry: null };
  }

  return { updated: true, entry: updatedEntry };
}
