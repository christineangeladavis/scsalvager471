// POST /api/me/delete-account
//
// Permanently deletes the calling user's account and every piece of
// data the site tracks about them. Auth required (the caller's session
// is what identifies which account to delete — there is no userId in
// the body, by design).
//
// Body must contain `{ "confirm": "DELETE_MY_ACCOUNT" }` exactly. This
// is a server-side belt over the client's two-step confirmation
// browser belt: a stray POST or replayed request can't accidentally
// wipe anyone.
//
// What gets wiped:
//   - ledger:{userId}                  — refinery jobs + sell orders
//   - prefs:{userId}                   — RSI handle, verification state,
//                                        Discord-DM opt-in, etc.
//   - user:{userId}                    — username + login/heartbeat mirror
//   - users:index (SREM)               — drops them from admin views
//                                        AND the Statistics aggregations
//                                        (api/stats.js iterates the index)
//   - logins:global ZSET members "{userId}:*"
//                                      — drops them from admin patch CSVs
//   - every session:* whose payload references this userId
//                                      — force-logs-them-out everywhere
//
// What we do NOT touch:
//   - Community price reports (api/prices.js). Those don't carry the
//     reporter's userId; they're aggregated medians that belong to the
//     community, and pulling individual data points would distort the
//     median for everyone else.
//
// Response shape:
//   200 { ok: true,  deletedAt: <ms>, errors?: [keys-that-failed] }
//   400 { error: "Missing or invalid confirmation" }
//   401 { error: "Not authenticated" }
//   503 { error: "Storage unavailable" }
//
// The session cookie is cleared via Set-Cookie on success, so the
// caller's browser drops it without needing a separate /logout call.

import { getRedis } from "../_lib/redis.js";
import {
  getSession,
  buildCookie,
  SESSION_COOKIE,
} from "../_lib/session.js";
import {
  USERS_INDEX_KEY,
  LOGINS_GLOBAL_KEY,
  userMetaKey,
} from "../_lib/userIndex.js";
import { ledgerKey } from "../ledger.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  res.setHeader("cache-control", "private, no-store");

  let redis;
  try {
    redis = getRedis();
  } catch (e) {
    return res.status(503).json({ error: "Storage unavailable" });
  }

  const session = await getSession(req, redis);
  if (!session) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  // Body must explicitly opt in. Vercel may give us either a parsed
  // object (when Content-Type: application/json) or a raw string — handle
  // both. Anything else, including a missing/wrong confirm value, gets
  // bounced before we touch any keys.
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  if (!body || body.confirm !== "DELETE_MY_ACCOUNT") {
    return res.status(400).json({ error: "Missing or invalid confirmation" });
  }

  const userId = String(session.userId || "");
  if (!userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const errors = [];

  // 1. Wipe the ledger (refinery jobs + sell orders).
  try {
    await redis.del(ledgerKey(userId));
  } catch (e) {
    console.error("delete-account: ledger del failed:", e && e.message);
    errors.push("ledger");
  }

  // 2. Wipe prefs (RSI handle/token/verified, Discord-DM opt-in).
  try {
    await redis.del(`prefs:${userId}`);
  } catch (e) {
    console.error("delete-account: prefs del failed:", e && e.message);
    errors.push("prefs");
  }

  // 3. Wipe user meta hash + drop from index set. Removing from the
  //    index is what makes Statistics + admin Active Users forget about
  //    this account — both endpoints walk the index.
  try {
    await redis.del(userMetaKey(userId));
  } catch (e) {
    console.error("delete-account: user meta del failed:", e && e.message);
    errors.push("userMeta");
  }
  try {
    await redis.srem(USERS_INDEX_KEY, userId);
  } catch (e) {
    console.error("delete-account: users:index srem failed:", e && e.message);
    errors.push("usersIndex");
  }

  // 4. Drop every login event for this user from the global ZSET.
  //    Members are formatted "<userId>:<ts>", so we filter and ZREM.
  //    This removes them from admin patch CSV exports — consistent with
  //    "remove all data tied to my unique ID."
  try {
    let cursor = "0";
    const matched = [];
    do {
      // Upstash returns either [cursor, members] (array form) or
      // { cursor, members } depending on call style. Use array form
      // explicitly and cast to keep it simple.
      const result = await redis.zscan(LOGINS_GLOBAL_KEY, cursor, {
        match: `${userId}:*`,
        count: 500,
      });
      const next = Array.isArray(result) ? result[0] : result?.cursor;
      // ZSCAN returns members interleaved with scores; we only need
      // the member strings.
      const items = Array.isArray(result) ? result[1] : result?.members;
      cursor = String(next ?? "0");
      if (Array.isArray(items)) {
        for (let i = 0; i < items.length; i += 2) {
          const member = items[i];
          if (typeof member === "string" && member.startsWith(`${userId}:`)) {
            matched.push(member);
          }
        }
      }
    } while (cursor !== "0");
    if (matched.length > 0) {
      // ZREM accepts a varargs list of members.
      await redis.zrem(LOGINS_GLOBAL_KEY, ...matched);
    }
  } catch (e) {
    console.error("delete-account: login events sweep failed:", e && e.message);
    errors.push("loginEvents");
  }

  // 5. Force-logout: walk every session:* key, DEL the ones that
  //    belong to this userId. This includes the caller's own session,
  //    so the next request from this browser will be unauth'd.
  try {
    let cursor = "0";
    const toDelete = [];
    do {
      const result = await redis.scan(cursor, {
        match: "session:*",
        count: 200,
      });
      const next = Array.isArray(result) ? result[0] : result?.cursor;
      const keys = Array.isArray(result) ? result[1] : result?.keys;
      cursor = String(next ?? "0");
      if (Array.isArray(keys) && keys.length > 0) {
        // Bulk-fetch each session payload and check ownership.
        for (const key of keys) {
          let data = null;
          try { data = await redis.get(key); } catch {}
          if (data && String(data.userId || "") === userId) {
            toDelete.push(key);
          }
        }
      }
    } while (cursor !== "0");
    if (toDelete.length > 0) {
      await redis.del(...toDelete);
    }
  } catch (e) {
    console.error("delete-account: session sweep failed:", e && e.message);
    errors.push("sessions");
  }

  // 6. Clear the session cookie on the caller's browser. The session
  //    record itself is already gone from Redis above, but emitting an
  //    expired Set-Cookie removes the residual cookie too so the next
  //    request doesn't carry a phantom token.
  res.setHeader(
    "Set-Cookie",
    buildCookie(SESSION_COOKIE, "", { maxAge: 0 })
  );

  return res.status(200).json({
    ok: true,
    deletedAt: Date.now(),
    ...(errors.length ? { errors } : {}),
  });
}
