// GET /api/auth/notifications-link
// Initiates a second-stage OAuth flow that requests `applications.commands`
// with integration_type=1 (user install). Authorizing this scope grants the
// bot permission to DM the user. Requires an existing logged-in session.
//
// On success → redirects to Discord's authorize page.
// Discord then redirects back to /api/auth/notifications-callback.

import { getRedis } from "../_lib/redis.js";
import {
  parseCookies,
  buildCookie,
  generateToken,
  getSession,
  STATE_TTL_SECONDS,
} from "../_lib/session.js";
import {
  getDiscordCredentials,
  buildAuthorizeUrl,
  getCallbackUri,
} from "../_lib/discord.js";

const NOTIFICATIONS_STATE_COOKIE = "scs_notif_state";
const NOTIFICATIONS_CALLBACK_PATH = "/api/auth/notifications-callback";

export default async function handler(req, res) {
  let redis;
  try {
    redis = getRedis();
  } catch (e) {
    console.error("notifications-link redis error:", e.message);
    return res.status(503).send("Storage unavailable. Please try again later.");
  }

  const session = await getSession(req, redis);
  if (!session) {
    return res.status(401).send("You need to be logged in to connect notifications.");
  }

  let credentials;
  try {
    credentials = getDiscordCredentials();
  } catch (e) {
    return res.status(503).send(e.message);
  }

  const state = generateToken();
  const redirectUri = getCallbackUri(req, NOTIFICATIONS_CALLBACK_PATH);

  // Bind state to the user via a separate cookie. The callback re-parses this
  // cookie and compares to the `state` query param, the same CSRF pattern the
  // login flow uses. Cookie is short-lived (10 min) and HttpOnly.
  res.setHeader("Set-Cookie", [
    buildCookie(NOTIFICATIONS_STATE_COOKIE, state, { maxAge: STATE_TTL_SECONDS }),
  ]);

  const authorizeUrl = buildAuthorizeUrl({
    clientId: credentials.clientId,
    redirectUri,
    state,
    // Both scopes: applications.commands (with integration_type=1) is what
    // grants DM permission; identify lets us verify in the callback that
    // the granting account matches the logged-in session account.
    scope: "identify applications.commands",
    extra: { integration_type: 1 },
    prompt: "consent",
  });

  res.writeHead(302, { Location: authorizeUrl });
  res.end();
}

export { NOTIFICATIONS_STATE_COOKIE, NOTIFICATIONS_CALLBACK_PATH };
