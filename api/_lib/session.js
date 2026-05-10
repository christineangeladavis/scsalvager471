// Session management — HTTP-only cookie + Redis-backed session data.
// Sessions expire after 7 days. Revocation on logout wipes the Redis key.

import crypto from "node:crypto";

export const SESSION_COOKIE = "scs_session";
export const STATE_COOKIE = "scs_oauth_state";
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
export const STATE_TTL_SECONDS = 600; // 10 minutes

function isSecureContext() {
  return process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
}

export function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(";").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx < 0) return;
    const name = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = value;
    }
  });
  return cookies;
}

export function buildCookie(name, value, { maxAge, httpOnly = true, sameSite = "Lax" } = {}) {
  const flags = [`${name}=${encodeURIComponent(value)}`, "Path=/", `SameSite=${sameSite}`];
  if (httpOnly) flags.push("HttpOnly");
  if (typeof maxAge === "number") flags.push(`Max-Age=${maxAge}`);
  if (isSecureContext()) flags.push("Secure");
  return flags.join("; ");
}

export function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

export async function getSession(req, redis) {
  // Cookie path is the primary auth surface (web client). The
  // desktop app reuses cookie auth inside its WebView, but its
  // Rust background poll runs outside the WebView and can't read
  // those cookies — fall back to Authorization: Bearer <token>
  // for that path. The token is the same opaque session id we
  // hand the WebView via cookie; storage backing in Redis is
  // identical, so no separate session shape needed.
  const cookies = parseCookies(req.headers.cookie || "");
  let token = cookies[SESSION_COOKIE];
  if (!token) {
    const authHeader = req.headers.authorization || req.headers.Authorization || "";
    if (typeof authHeader === "string" && authHeader.toLowerCase().startsWith("bearer ")) {
      const candidate = authHeader.slice(7).trim();
      if (candidate) token = candidate;
    }
  }
  if (!token) return null;
  try {
    const data = await redis.get(`session:${token}`);
    if (!data) return null;
    return { token, ...data };
  } catch (e) {
    console.error("getSession redis error:", e && e.message ? e.message : e);
    return null;
  }
}

export async function createSession(redis, user) {
  const token = generateToken();
  const now = Date.now();
  await redis.set(
    `session:${token}`,
    {
      userId: user.id,
      discordUsername: user.username,
      discordAvatar: user.avatar,
      createdAt: now,
      expiresAt: now + SESSION_TTL_SECONDS * 1000,
    },
    { ex: SESSION_TTL_SECONDS }
  );
  return token;
}

export async function deleteSession(redis, token) {
  if (!token) return;
  try {
    await redis.del(`session:${token}`);
  } catch (e) {
    console.error("deleteSession redis error:", e && e.message ? e.message : e);
  }
}
