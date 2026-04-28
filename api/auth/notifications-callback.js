// GET /api/auth/notifications-callback?code=...&state=...
//
// Completes the user-install OAuth flow that grants the bot DM permission.
// Verifies CSRF state, exchanges the code (proves the user actually completed
// the grant rather than just visiting this URL), confirms the authorized
// Discord user matches the currently-logged-in session, then marks the user
// as notification-linked in Redis. Redirects home with a query flag the UI
// uses to auto-open Settings and show success/error feedback.

import { getRedis } from "../_lib/redis.js";
import {
  parseCookies,
  getSession,
  buildCookie,
} from "../_lib/session.js";
import {
  getDiscordCredentials,
  exchangeCodeForToken,
  fetchDiscordUser,
  getCallbackUri,
} from "../_lib/discord.js";
import { markNotificationsLinked } from "../_lib/prefs.js";

const NOTIFICATIONS_STATE_COOKIE = "scs_notif_state";
const NOTIFICATIONS_CALLBACK_PATH = "/api/auth/notifications-callback";

function redirect(res, url, clearStateCookie = true) {
  const headers = { Location: url };
  if (clearStateCookie) {
    res.setHeader("Set-Cookie", [
      buildCookie(NOTIFICATIONS_STATE_COOKIE, "", { maxAge: 0 }),
    ]);
  }
  res.writeHead(302, headers);
  res.end();
}

export default async function handler(req, res) {
  const code = req.query && req.query.code;
  const state = req.query && req.query.state;
  const error = req.query && req.query.error;
  const cookies = parseCookies(req.headers.cookie || "");
  const storedState = cookies[NOTIFICATIONS_STATE_COOKIE];

  // User clicked "Cancel" or denied the grant on Discord's authorization page.
  if (error) {
    return redirect(res, `/?notifications=denied`);
  }

  if (!code || !state || !storedState || state !== storedState) {
    return redirect(res, `/?notifications=error&reason=state`);
  }

  let redis;
  try {
    redis = getRedis();
  } catch (e) {
    console.error("notifications-callback redis error:", e.message);
    return redirect(res, `/?notifications=error&reason=storage`);
  }

  // The user must still have a valid login session. If they don't (cookie
  // expired, signed out in another tab, etc.) we can't link the grant to
  // anyone, so abort.
  const session = await getSession(req, redis);
  if (!session) {
    // Diagnostic: surface why the session check failed so we can tell
    // a genuine 7-day expiry apart from a host-mismatch (cookie scoped
    // to www.* but callback running on canonical, etc.).
    console.warn("[oauth/notifications-callback] no session", {
      hasSessionCookie: !!cookies.scs_session,
      hasStateCookie: !!storedState,
      stateMatched: !!storedState && state === storedState,
      host: req.headers.host,
      xfh: req.headers["x-forwarded-host"],
      cookieHeaderLen: (req.headers.cookie || "").length,
    });
    return redirect(res, `/?notifications=error&reason=session`);
  }

  let credentials;
  try {
    credentials = getDiscordCredentials();
  } catch (e) {
    console.error("notifications-callback credentials error:", e.message);
    return redirect(res, `/?notifications=error&reason=config`);
  }

  try {
    const redirectUri = getCallbackUri(req, NOTIFICATIONS_CALLBACK_PATH);
    const tokenResponse = await exchangeCodeForToken({
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      code,
      redirectUri,
    });
    // Identify the granting user via the access token. The `applications.commands`
    // scope alone doesn't include identity, but Discord includes the user object
    // on the /users/@me endpoint as long as we have a bearer token, so this works.
    // If it ever stops working we'll receive a 401 here and fail closed.
    const grantingUser = await fetchDiscordUser(tokenResponse.access_token);

    if (!grantingUser || !grantingUser.id) {
      return redirect(res, `/?notifications=error&reason=identity`);
    }

    // Defense in depth: ensure the OAuth grant came from the same Discord
    // account that's currently logged in. Without this check a malicious
    // page could trick a logged-in user into linking a different account.
    if (String(grantingUser.id) !== String(session.userId)) {
      console.warn(
        `notifications-callback: granting user ${grantingUser.id} != session user ${session.userId}`
      );
      return redirect(res, `/?notifications=error&reason=mismatch`);
    }

    await markNotificationsLinked(redis, session.userId);
    return redirect(res, `/?notifications=linked`);
  } catch (e) {
    console.error("notifications-callback exchange error:", e && e.message ? e.message : e);
    return redirect(res, `/?notifications=error&reason=exchange`);
  }
}
