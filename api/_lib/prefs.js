// User preferences — stored in Redis under `prefs:{userId}`. All keys are
// optional; reads merge stored values over a `defaultPrefs()` skeleton so new
// preference fields can be added without a migration.
//
// Schema (all fields optional in storage, defaulted on read):
//   discordNotifications   : boolean   — opt-in to Discord DMs on job completion
//   notificationLinkedAt   : number    — ms timestamp when user granted DM scope
//                                        (null until they complete the link flow)

export function defaultPrefs() {
  return {
    discordNotifications: false,
    notificationLinkedAt: null,
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
