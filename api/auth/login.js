// GET /api/auth/login
// Starts Discord OAuth. Sets a short-lived CSRF state cookie, then 302s to Discord.

import { generateToken, buildCookie, STATE_COOKIE, STATE_TTL_SECONDS } from "../_lib/session.js";
import { getDiscordCredentials, buildAuthorizeUrl, getCallbackUri } from "../_lib/discord.js";

export default async function handler(req, res) {
  let credentials;
  try {
    credentials = getDiscordCredentials();
  } catch (e) {
    console.error("Discord credentials missing:", e.message);
    return res.status(503).send(e.message);
  }

  const state = generateToken();
  const redirectUri = getCallbackUri(req);
  const authorizeUrl = buildAuthorizeUrl({
    clientId: credentials.clientId,
    redirectUri,
    state,
  });

  res.setHeader("Set-Cookie", buildCookie(STATE_COOKIE, state, { maxAge: STATE_TTL_SECONDS }));
  res.writeHead(302, { Location: authorizeUrl });
  res.end();
}
