// GET /api/auth/login
// Starts Discord OAuth. Sets a short-lived CSRF state cookie, then 302s to Discord.

import { generateToken, buildCookie, STATE_COOKIE, STATE_TTL_SECONDS } from "../_lib/session.js";
import { getDiscordCredentials, buildAuthorizeUrl, getCallbackUri, getOrigin } from "../_lib/discord.js";
import { getRedis } from "../_lib/redis.js";

// Canonical production host. Discord OAuth redirect_uri is pinned to
// this exact origin (see api/_lib/discord.js), so the state cookie
// MUST also be set on this host or the callback can't read it.
const CANONICAL_HOST = "scsalvager.net";

export default async function handler(req, res) {
  let credentials;
  try {
    credentials = getDiscordCredentials();
  } catch (e) {
    console.error("Discord credentials missing:", e.message);
    return res.status(503).send(e.message);
  }

  // If the user hit /api/auth/login on a non-canonical host (e.g.
  // www.scsalvager.net or a *.vercel.app preview), bounce them to the
  // canonical host first. Otherwise the state cookie ends up scoped
  // to the wrong host and the callback (which lands on canonical via
  // the pinned redirect_uri) can't read it -> "Invalid OAuth state".
  const incomingHost = (req.headers["x-forwarded-host"] || req.headers.host || "").toLowerCase();
  const isProd =
    process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
  if (isProd && incomingHost && incomingHost !== CANONICAL_HOST) {
    const canonicalLogin = `https://${CANONICAL_HOST}/api/auth/login`;
    console.log("[oauth/login] non-canonical host=%s, redirecting to %s", incomingHost, canonicalLogin);
    res.writeHead(302, { Location: canonicalLogin });
    res.end();
    return;
  }

  const state = generateToken();
  // Defense-in-depth: also persist the state token in Redis with the
  // same 10-minute TTL. The callback validates against the cookie
  // first; if the cookie didn't survive the Discord round-trip
  // (third-party-cookie blockers, Firefox Total Cookie Protection,
  // adblockers, mixed-canonical-host scope issues), the Redis copy
  // is the fallback. Single-use — the callback DELs it on success.
  // Best-effort: Redis errors here don't block the OAuth flow; the
  // cookie path still works for users whose cookies stick.
  try {
    const redis = getRedis();
    await redis.set(`oauth-state:${state}`, JSON.stringify({ createdAt: Date.now() }), {
      ex: STATE_TTL_SECONDS,
    });
  } catch (e) {
    console.warn("[oauth/login] redis state-write failed:", e && e.message ? e.message : e);
  }
  // Optional `?return=desktop-callback` puts a short-lived
  // `scs_return_to` cookie next to the state cookie so the OAuth
  // callback can redirect to the desktop deep-link bridge instead
  // of `/`. Other return values are rejected to avoid open
  // redirects. Add new whitelisted targets here.
  const ALLOWED_RETURN_TARGETS = new Set(["desktop-callback"]);
  const requestedReturn = (req.query && typeof req.query.return === "string"
    ? req.query.return
    : ""
  ).trim();
  const returnTarget = ALLOWED_RETURN_TARGETS.has(requestedReturn)
    ? requestedReturn
    : "";
  const redirectUri = getCallbackUri(req);
  // Log the resolved redirect_uri + the host headers that fed it so we
  // can diagnose "Invalid OAuth2 redirect_uri" errors by grepping
  // Vercel logs. Stays in production — pure observability, no PII.
  console.log("[oauth/login] redirect_uri=%s host=%s xfh=%s xfp=%s SITE_URL=%s",
    redirectUri,
    req.headers.host,
    req.headers["x-forwarded-host"],
    req.headers["x-forwarded-proto"],
    process.env.SITE_URL || "(unset)"
  );
  const authorizeUrl = buildAuthorizeUrl({
    clientId: credentials.clientId,
    redirectUri,
    state,
  });

  const cookies = [buildCookie(STATE_COOKIE, state, { maxAge: STATE_TTL_SECONDS })];
  if (returnTarget) {
    // 10-minute TTL matches the state cookie; cleared by the
    // callback after consumption regardless of outcome.
    cookies.push(
      buildCookie("scs_return_to", returnTarget, { maxAge: STATE_TTL_SECONDS })
    );
  }
  res.setHeader("Set-Cookie", cookies);
  res.writeHead(302, { Location: authorizeUrl });
  res.end();
}
