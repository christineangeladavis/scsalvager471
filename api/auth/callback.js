// GET /api/auth/callback?code=...&state=...
// Verifies CSRF state, exchanges code for Discord access token, creates session, redirects home.

import { getRedis } from "../_lib/redis.js";
import {
  parseCookies,
  createSession,
  buildCookie,
  SESSION_COOKIE,
  STATE_COOKIE,
  SESSION_TTL_SECONDS,
} from "../_lib/session.js";
import {
  getDiscordCredentials,
  exchangeCodeForToken,
  fetchDiscordUser,
  getCallbackUri,
} from "../_lib/discord.js";
import { recordUserLogin } from "../_lib/userIndex.js";

export default async function handler(req, res) {
  const code = req.query && req.query.code;
  const state = req.query && req.query.state;
  const cookies = parseCookies(req.headers.cookie || "");
  const storedState = cookies[STATE_COOKIE];

  if (!code || !state) {
    console.warn("[oauth/callback] missing code or state", {
      hasCode: !!code,
      hasQueryState: !!state,
    });
    return res
      .status(400)
      .send("Invalid OAuth callback. Please return to the home page and try logging in again.");
  }

  let redis;
  try {
    redis = getRedis();
  } catch (e) {
    console.error("Redis unavailable on callback:", e.message);
    return res.status(503).send("Storage unavailable. Please try again later.");
  }

  // Validate state against the cookie OR a Redis-backed mirror. The
  // mirror is the fallback for users whose state cookie got stripped
  // during the Discord round-trip (third-party-cookie blockers,
  // Firefox Total Cookie Protection, adblockers, mixed canonical
  // host). Single-use: the Redis key is DEL'd on the first match
  // regardless of which path validated, so a replay of the same
  // ?code=&state= URL can't reuse it.
  const cookieMatched = !!storedState && state === storedState;
  let redisMatched = false;
  try {
    const stateKey = `oauth-state:${state}`;
    const stored = await redis.get(stateKey);
    if (stored) {
      redisMatched = true;
      // Consume on first read.
      await redis.del(stateKey);
    }
  } catch (e) {
    console.warn("[oauth/callback] redis state-read failed:", e && e.message ? e.message : e);
  }

  if (!cookieMatched && !redisMatched) {
    console.warn("[oauth/callback] state mismatch", {
      hasCode: !!code,
      hasQueryState: !!state,
      hasCookieState: !!storedState,
      cookieMatched,
      redisMatched,
      host: req.headers.host,
      xfh: req.headers["x-forwarded-host"],
      cookieHeaderLen: (req.headers.cookie || "").length,
    });
    return res
      .status(400)
      .send("Invalid OAuth state. Please return to the home page and try logging in again.");
  }
  // Diagnostic: which path saved this user's login? Helps gauge how
  // many users rely on the Redis fallback so we can tune accordingly.
  console.log("[oauth/callback] state ok", {
    cookieMatched,
    redisMatched,
    fallbackUsed: !cookieMatched && redisMatched,
  });

  let credentials;
  try {
    credentials = getDiscordCredentials();
  } catch (e) {
    console.error("Discord credentials missing on callback:", e.message);
    return res.status(503).send(e.message);
  }

  try {
    const redirectUri = getCallbackUri(req);
    const tokenResponse = await exchangeCodeForToken({
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      code,
      redirectUri,
    });
    const discordUser = await fetchDiscordUser(tokenResponse.access_token);

    const displayName = discordUser.global_name || discordUser.username || "Unknown";
    const sessionToken = await createSession(redis, {
      id: String(discordUser.id),
      username: displayName,
      avatar: discordUser.avatar || null,
    });

    // Index this login so admin views can list every known user. Best-effort —
    // failure here doesn't block the login flow.
    await recordUserLogin(redis, {
      id: String(discordUser.id),
      username: displayName,
    });

    // Honor an optional return target (set by /api/auth/login when
    // the desktop app initiated the flow). Whitelist enforced here
    // too so a stray cookie value can't open-redirect anywhere.
    const returnTarget = (cookies["scs_return_to"] || "").trim();
    let postLoginPath = "/";
    if (returnTarget === "desktop-callback") {
      postLoginPath = "/api/auth/desktop-callback";
    }

    res.setHeader("Set-Cookie", [
      buildCookie(STATE_COOKIE, "", { maxAge: 0 }),
      // Always clear scs_return_to after consumption — single-use.
      buildCookie("scs_return_to", "", { maxAge: 0 }),
      // SameSite=Lax (not Strict) so the cookie still rides on
      // top-level cross-site navigations like Discord -> our OAuth
      // callbacks. Strict would block notifications-callback from
      // ever seeing the session cookie when Discord redirects back,
      // which surfaced as "Your login session expired" when users
      // tried to connect Discord DMs. Lax keeps CSRF protection on
      // POST/iframe-style cross-site requests.
      buildCookie(SESSION_COOKIE, sessionToken, { maxAge: SESSION_TTL_SECONDS, sameSite: "Lax" }),
    ]);
    res.writeHead(302, { Location: postLoginPath });
    res.end();
  } catch (e) {
    console.error("Auth callback error:", e && e.message ? e.message : e);
    res.status(500).send("Login failed. Please return to the home page and try again.");
  }
}
