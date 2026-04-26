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
// Sorted set of login events. Score = timestampMs, member =
// "<userId>:<timestampMs>" so simultaneous logins from different users
// stay distinct. Range queries by patch cycle window are O(log N + M).
export const LOGINS_GLOBAL_KEY = "logins:global";
// Cap how many login events we retain in the global set to keep memory
// bounded across a long-running site. 100k events at ~50 bytes each is
// ~5MB. Older events get trimmed; admins can still see the most recent
// ~hundreds-of-patches' worth of activity.
const MAX_LOGINS_RETAINED = 100000;

export function userMetaKey(userId) {
  return `user:${userId}`;
}

/**
 * Idempotent at the user-index/meta layer; appends a fresh entry to
 * the login event log every time. Call from the auth callback on every
 * successful login. Best-effort: failures are logged but do not block
 * login.
 */
export async function recordUserLogin(redis, { id, username }) {
  if (!redis || !id) return;
  const userId = String(id);
  const ts = Date.now();
  try {
    await redis.sadd(USERS_INDEX_KEY, userId);
    await redis.hset(userMetaKey(userId), {
      username: String(username || "Unknown").slice(0, 80),
      lastLoginAt: ts,
    });
    // Append the login event to the global sorted set so admin patch
    // exports can do range queries without scanning every user's hash.
    await redis.zadd(LOGINS_GLOBAL_KEY, {
      score: ts,
      member: `${userId}:${ts}`,
    });
    // Trim the oldest events once we exceed the retention cap.
    const card = await redis.zcard(LOGINS_GLOBAL_KEY);
    if (Number.isFinite(card) && card > MAX_LOGINS_RETAINED) {
      // Drop the lowest-scored (oldest) entries down to the cap.
      await redis.zremrangebyrank(LOGINS_GLOBAL_KEY, 0, card - MAX_LOGINS_RETAINED - 1);
    }
  } catch (e) {
    console.error(
      "recordUserLogin failed:",
      e && e.message ? e.message : e
    );
  }
}

/**
 * Returns every login event whose timestamp is in [from, to).
 * Each entry: { userId, timestampMs }.
 */
export async function listLoginsInRange(redis, from, to) {
  try {
    // Upstash zrange supports byScore + offset/count semantics; passing
    // (max, min) with reverse:false isn't quite right — simpler to fetch
    // by score range explicitly.
    const members = await redis.zrange(LOGINS_GLOBAL_KEY, from, to - 1, {
      byScore: true,
    });
    if (!Array.isArray(members)) return [];
    return members
      .map((m) => {
        const sep = m.lastIndexOf(":");
        if (sep < 0) return null;
        const userId = m.slice(0, sep);
        const ts = Number(m.slice(sep + 1));
        if (!Number.isFinite(ts)) return null;
        return { userId, timestampMs: ts };
      })
      .filter(Boolean);
  } catch (e) {
    console.error(
      "listLoginsInRange failed:",
      e && e.message ? e.message : e
    );
    return [];
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
