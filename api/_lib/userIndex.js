// Tracks every Discord user who has ever logged in to the site so admin
// views can fan out to read each user's ledger.
//
// Layout:
//   Set "users:index"        — every userId that has logged in at least once
//   Hash "user:<userId>"     — { username, lastLoginAt }
//
// Username mirror keeps the admin view from having to hold open every
// session just to render display names.

export const USERS_INDEX_KEY = "users:index";

export function userMetaKey(userId) {
  return `user:${userId}`;
}

/**
 * Idempotent — call from the auth callback on every successful login.
 * Updates the username mirror so display name changes propagate next login.
 * Best-effort: failures are logged but do not block login.
 */
export async function recordUserLogin(redis, { id, username }) {
  if (!redis || !id) return;
  const userId = String(id);
  try {
    await redis.sadd(USERS_INDEX_KEY, userId);
    await redis.hset(userMetaKey(userId), {
      username: String(username || "Unknown").slice(0, 80),
      lastLoginAt: Date.now(),
    });
  } catch (e) {
    console.error(
      "recordUserLogin failed:",
      e && e.message ? e.message : e
    );
  }
}

/**
 * Returns every known userId that has ever logged in.
 */
export async function listUserIds(redis) {
  try {
    const ids = await redis.smembers(USERS_INDEX_KEY);
    return Array.isArray(ids) ? ids : [];
  } catch (e) {
    console.error("listUserIds failed:", e && e.message ? e.message : e);
    return [];
  }
}

/**
 * Reads a user's mirrored metadata. Returns null if missing.
 */
export async function getUserMeta(redis, userId) {
  try {
    const meta = await redis.hgetall(userMetaKey(userId));
    if (!meta || !meta.username) return null;
    return {
      username: meta.username,
      lastLoginAt: Number(meta.lastLoginAt) || null,
    };
  } catch (e) {
    console.error("getUserMeta failed:", e && e.message ? e.message : e);
    return null;
  }
}
