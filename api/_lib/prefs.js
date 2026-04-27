// User preferences — stored in Redis under `prefs:{userId}`. All keys are
// optional; reads merge stored values over a `defaultPrefs()` skeleton so new
// preference fields can be added without a migration.
//
// Schema (all fields optional in storage, defaulted on read):
//   discordNotifications   : boolean   — opt-in to Discord DMs on job completion
//   notificationLinkedAt   : number    — ms timestamp when user granted DM scope
//                                        (null until they complete the link flow)
//   rsiHandle              : string    — user's RSI Star Citizen handle. When
//                                        set, this displays in place of their
//                                        Discord username on the Statistics
//                                        leaderboard. Empty string means unset.
//   rsiHandleToken         : string    — per-user verification token. The user
//                                        pastes this into their RSI Short Bio,
//                                        we fetch the public profile page, and
//                                        substring-match for the token. Server-
//                                        managed: regenerated when the handle
//                                        changes, cleared when handle is wiped.
//   rsiHandleVerified      : boolean   — true once the RSI profile fetch found
//                                        the token in the bio. Resets to false
//                                        whenever the handle changes.
//   rsiHandleVerifiedAt    : number    — ms timestamp of last successful verify;
//                                        null when never verified.

import crypto from "node:crypto";

// RSI handles are 3–24 chars, alphanumeric + dash + underscore per RSI's own
// validator. We're permissive on length and only enforce a sane upper cap so
// nobody jams a novel into the field.
const RSI_HANDLE_MAX_LEN = 32;

// 8 hex chars = 32 bits of entropy, plenty for our purposes (collision odds
// at our user count are trivial and the token is just a "did the user paste
// this string into their bio" check, not a security primitive). Hex avoids
// the 0/O/1/I/l confusables that bite users when they hand-copy.
export function generateRsiHandleToken() {
  return "SCSV-" + crypto.randomBytes(4).toString("hex").toUpperCase();
}

export function defaultPrefs() {
  return {
    discordNotifications: false,
    notificationLinkedAt: null,
    rsiHandle: "",
    rsiHandleToken: "",
    rsiHandleVerified: false,
    rsiHandleVerifiedAt: null,
  };
}

function prefsKey(userId) {
  return `prefs:${userId}`;
}

/**
 * Read a user's preferences, merged over defaults so callers never have to
 * worry about missing fields.
 */
export async function getPrefs(redis, userId) {
  if (!userId) return defaultPrefs();
  try {
    const stored = await redis.get(prefsKey(userId));
    return { ...defaultPrefs(), ...(stored || {}) };
  } catch (e) {
    console.error("getPrefs redis error:", e && e.message ? e.message : e);
    return defaultPrefs();
  }
}

/**
 * Validate and normalize a partial preferences update from an untrusted source
 * (typically a client request body). Unknown fields are dropped. Returns a
 * sanitized object containing only the fields that were valid.
 */
export function sanitizePrefsUpdate(input) {
  if (!input || typeof input !== "object") return {};
  const out = {};
  if (typeof input.discordNotifications === "boolean") {
    out.discordNotifications = input.discordNotifications;
  }
  if (typeof input.rsiHandle === "string") {
    // Trim whitespace and cap length. Empty string is a valid value — it
    // means "clear the handle" and the leaderboard will fall back to the
    // Discord username.
    const trimmed = input.rsiHandle.trim().slice(0, RSI_HANDLE_MAX_LEN);
    out.rsiHandle = trimmed;
  }
  // notificationLinkedAt is server-managed; clients cannot set it directly.
  return out;
}

/**
 * Merge a partial update into a user's stored preferences and persist.
 * Returns the full merged preferences object that resulted.
 */
export async function updatePrefs(redis, userId, update) {
  if (!userId) throw new Error("updatePrefs: userId required");
  const current = await getPrefs(redis, userId);
  const next = { ...current, ...update };
  await redis.set(prefsKey(userId), next);
  return next;
}

/**
 * Server-only: record that a user has completed the Discord notifications
 * OAuth link. Sets `notificationLinkedAt` to now. Does NOT toggle
 * `discordNotifications` — the user must explicitly opt in.
 */
export async function markNotificationsLinked(redis, userId) {
  return updatePrefs(redis, userId, { notificationLinkedAt: Date.now() });
}

/**
 * Server-only: clear the Discord notifications link. Used when the user
 * disconnects from the Settings UI. Also turns notifications off so we
 * don't try to deliver to an unlinked account.
 */
export async function markNotificationsUnlinked(redis, userId) {
  return updatePrefs(redis, userId, {
    notificationLinkedAt: null,
    discordNotifications: false,
  });
}

/**
 * Server-only: mark the user's RSI handle as verified. Called by the
 * verify endpoint after a successful profile fetch + token match.
 */
export async function markRsiHandleVerified(redis, userId) {
  return updatePrefs(redis, userId, {
    rsiHandleVerified: true,
    rsiHandleVerifiedAt: Date.now(),
  });
}
