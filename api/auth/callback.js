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

  if (!code || !state || !storedState || state !== storedState) {
    return res
      .status(400)
      .send("Invalid OAuth state. Please return to the home page and try logging in again.");
  }

  let credentials;
  try {
    credentials = getDiscordCredentials();
  } catch (e) {
    console.error("Discord credentials missing on callback:", e.message);
    return res.status(503).send(e.message);
  }

  let redis;
  try {
    redis = getRedis();
  } catch (e) {
    console.error("Redis unavailable on callback:", e.message);
    return res.status(503).send("Storage unavailable. Please try again later.");
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

    res.setHeader("Set-Cookie", [
      buildCookie(STATE_COOKIE, "", { maxAge: 0 }),
      buildCookie(SESSION_COOKIE, sessionToken, { maxAge: SESSION_TTL_SECONDS, sameSite: "Strict" }),
    ]);
    res.writeHead(302, { Location: "/" });
    res.end();
  } catch (e) {
    console.error("Auth callback error:", e && e.message ? e.message : e);
    res.status(500).send("Login failed. Please return to the home page and try again.");
  }
}
