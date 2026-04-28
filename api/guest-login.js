// POST /api/guest-login
//
// Fired once per browser per ~24h by anonymous visitors so admins can
// see how much traffic is hitting the site without signing in. Logged-in
// visitors are deliberately ignored — their activity already shows up in
// the All Users / 7-Day History views.
//
// Dedupe: a 24h `scs_guest_visit` cookie. If it's already present, we
// skip the Redis write and just refresh the cookie. This keeps the list
// to roughly "one entry per unique browser per day" instead of one per
// page load.
//
// IP is deliberately NOT collected. We capture only user-agent and the
// CDN-supplied country code — enough to gauge browser mix and rough
// geography without persisting source addresses.

import { getRedis } from "./_lib/redis.js";
import { getSession } from "./_lib/session.js";
import { recordGuestLogin } from "./_lib/guestLogins.js";
import { parseCookies, buildCookie } from "./_lib/session.js";

const GUEST_VISIT_COOKIE = "scs_guest_visit";
const GUEST_VISIT_TTL_SECONDS = 24 * 60 * 60; // 24h

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  res.setHeader("cache-control", "private, no-store");

  let redis;
  try {
    redis = getRedis();
  } catch {
    // Redis outage shouldn't break the visitor's page load — return 204
    // and let the client move on.
    return res.status(204).end();
  }

  // Skip if the caller is actually signed in. Their activity is already
  // captured by the login event log.
  const session = await getSession(req, redis);
  if (session && session.userId) {
    return res.status(204).end();
  }

  const cookies = parseCookies(req.headers.cookie || "");
  const seenAt = Number(cookies[GUEST_VISIT_COOKIE]);
  const now = Date.now();
  const recentlySeen =
    Number.isFinite(seenAt) && now - seenAt < GUEST_VISIT_TTL_SECONDS * 1000;

  // Always refresh the cookie so the dedupe window slides forward as the
  // visitor keeps browsing.
  res.setHeader(
    "Set-Cookie",
    buildCookie(GUEST_VISIT_COOKIE, String(now), {
      maxAge: GUEST_VISIT_TTL_SECONDS,
      httpOnly: true,
      sameSite: "Lax",
    })
  );

  if (recentlySeen) {
    return res.status(204).end();
  }

  const userAgent =
    typeof req.headers["user-agent"] === "string"
      ? req.headers["user-agent"]
      : "";
  // Vercel sets x-vercel-ip-country on the edge; best-effort, may be empty.
  const country =
    typeof req.headers["x-vercel-ip-country"] === "string"
      ? req.headers["x-vercel-ip-country"]
      : "";

  await recordGuestLogin(redis, { userAgent, country });
  return res.status(204).end();
}
