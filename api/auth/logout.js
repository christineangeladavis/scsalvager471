// POST /api/auth/logout   (or GET for a form-free sign-out link)
// Deletes the session from Redis and clears the cookie. On GET, also
// redirects back to the home page so users clicking a plain <a href>
// don't see a JSON blob.

import { getRedis } from "../_lib/redis.js";
import { parseCookies, deleteSession, buildCookie, SESSION_COOKIE } from "../_lib/session.js";

export default async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const cookies = parseCookies(req.headers.cookie || "");
  const token = cookies[SESSION_COOKIE];

  try {
    const redis = getRedis();
    await deleteSession(redis, token);
  } catch (e) {
    // Even if Redis is down, we still clear the cookie so the client is logged out
    console.error("Logout redis error:", e && e.message ? e.message : e);
  }

  res.setHeader("Set-Cookie", buildCookie(SESSION_COOKIE, "", { maxAge: 0 }));

  if (req.method === "GET") {
    res.writeHead(302, { Location: "/" });
    return res.end();
  }

  return res.status(200).json({ ok: true });
}
