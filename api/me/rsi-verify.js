// POST /api/me/rsi-verify
//
// Confirms ownership of an RSI handle by fetching the public profile
// page (https://robertsspaceindustries.com/citizens/{handle}) and
// checking whether the user's per-account verification token appears
// anywhere in the response body. The user pastes that token into their
// RSI Short Bio; once we see it, we mark `rsiHandleVerified = true` in
// their prefs and the Statistics leaderboard renders a ✓ next to their
// name.
//
// Auth: any logged-in user. Operates on the caller's own prefs only.
//
// Response shape:
//   { ok: true,  verified: true,  prefs }                — match found
//   { ok: false, verified: false, reason: "no_handle" }  — handle not set
//   { ok: false, verified: false, reason: "no_token" }   — token missing
//   { ok: false, verified: false, reason: "handle_not_found" }  — RSI 404
//   { ok: false, verified: false, reason: "no_match" }   — token not in bio
//   { ok: false, verified: false, reason: "fetch_error", detail }
//   { ok: false, verified: false, reason: "rate_limited", retryAfterMs }
//
// Rate limiting: per-user counter in Redis, 1 attempt per 15 seconds and
// at most 20 attempts per hour. The hourly cap exists so a misconfigured
// client can't accidentally hammer RSI's profile pages.

import { getRedis } from "../_lib/redis.js";
import { getSession } from "../_lib/session.js";
import {
  getPrefs,
  markRsiHandleVerified,
} from "../_lib/prefs.js";

const RSI_PROFILE_BASE = "https://robertsspaceindustries.com/citizens/";
const FETCH_TIMEOUT_MS = 8000;
const MAX_BODY_BYTES = 256 * 1024; // 256 KB ceiling on the response body
const RATE_BURST_MS = 15 * 1000;        // 1 attempt / 15s
const RATE_HOURLY_MAX = 20;             // 20 attempts / hour
const RATE_HOURLY_WINDOW_MS = 60 * 60 * 1000;

function rateBurstKey(userId) {
  return `rsiverify:burst:${userId}`;
}
function rateHourlyKey(userId) {
  return `rsiverify:hourly:${userId}`;
}

async function checkAndBumpRateLimits(redis, userId) {
  // Burst guard: short-TTL flag key. If it's already set, bounce.
  try {
    const set = await redis.set(rateBurstKey(userId), "1", {
      nx: true,
      px: RATE_BURST_MS,
    });
    if (set !== "OK" && set !== true) {
      const ttl = await redis.pttl(rateBurstKey(userId));
      return { ok: false, retryAfterMs: ttl > 0 ? ttl : RATE_BURST_MS };
    }
  } catch (e) {
    // If Redis flakes here, fall through — better to attempt the verify
    // than to wedge users on a transient infra blip.
    console.warn("rsi-verify: rate limiter (burst) error:", e && e.message);
  }

  // Hourly counter: incr + set expiry on first hit of the window.
  try {
    const count = await redis.incr(rateHourlyKey(userId));
    if (count === 1) {
      await redis.pexpire(rateHourlyKey(userId), RATE_HOURLY_WINDOW_MS);
    }
    if (count > RATE_HOURLY_MAX) {
      const ttl = await redis.pttl(rateHourlyKey(userId));
      return { ok: false, retryAfterMs: ttl > 0 ? ttl : RATE_HOURLY_WINDOW_MS };
    }
  } catch (e) {
    console.warn("rsi-verify: rate limiter (hourly) error:", e && e.message);
  }

  return { ok: true };
}

// Fetch the public RSI profile page with a timeout and a hard body cap.
// We read the response as text and substring-search for the token, so we
// don't bother parsing the HTML. The token is unique enough (`SCSV-` +
// 8 hex) that an accidental match anywhere on the page is implausible.
async function fetchRsiProfileBody(handle) {
  const url = RSI_PROFILE_BASE + encodeURIComponent(handle);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent": "scsalvager-rsi-verify (+https://scsalvager.net)",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: controller.signal,
    });
    if (res.status === 404) {
      return { ok: false, reason: "handle_not_found", status: 404 };
    }
    if (!res.ok) {
      return { ok: false, reason: "fetch_error", status: res.status };
    }
    // Read the body up to MAX_BODY_BYTES. The RSI profile page is well
    // under that, but we cap defensively in case of an unexpected server
    // response or a chunked-transfer scenario.
    const reader = res.body && res.body.getReader ? res.body.getReader() : null;
    if (!reader) {
      const text = await res.text();
      return { ok: true, body: text.slice(0, MAX_BODY_BYTES) };
    }
    const decoder = new TextDecoder("utf-8");
    let body = "";
    while (body.length < MAX_BODY_BYTES) {
      const { value, done } = await reader.read();
      if (done) break;
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    return { ok: true, body: body.slice(0, MAX_BODY_BYTES) };
  } catch (e) {
    const isAbort = e && (e.name === "AbortError" || e.code === "ABORT_ERR");
    return {
      ok: false,
      reason: "fetch_error",
      detail: isAbort ? "timeout" : (e && e.message) || "unknown",
    };
  } finally {
    clearTimeout(timer);
  }
}

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
    return res.status(503).json({ error: e.message });
  }

  const session = await getSession(req, redis);
  if (!session) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const rate = await checkAndBumpRateLimits(redis, session.userId);
  if (!rate.ok) {
    return res.status(429).json({
      ok: false,
      verified: false,
      reason: "rate_limited",
      retryAfterMs: rate.retryAfterMs,
    });
  }

  const prefs = await getPrefs(redis, session.userId);
  const handle = (prefs.rsiHandle || "").trim();
  const token = (prefs.rsiHandleToken || "").trim();
  if (!handle) {
    return res.status(400).json({
      ok: false,
      verified: false,
      reason: "no_handle",
    });
  }
  if (!token) {
    // A handle is set but no token has been issued yet — shouldn't
    // happen given the prefs POST handler issues one on save, but
    // guard anyway to avoid trivially-true verifications.
    return res.status(400).json({
      ok: false,
      verified: false,
      reason: "no_token",
    });
  }

  const fetched = await fetchRsiProfileBody(handle);
  if (!fetched.ok) {
    return res.status(fetched.reason === "handle_not_found" ? 404 : 502).json({
      ok: false,
      verified: false,
      reason: fetched.reason,
      detail: fetched.detail || null,
    });
  }

  // Substring match. The token format (`SCSV-` + 8 hex) is unique enough
  // that we don't need to parse the bio block out of the HTML — if the
  // exact string is anywhere on the rendered profile page, the user put
  // it there. Case-insensitive to forgive bio-editor capitalization
  // quirks (the random part is already uppercase so this only matters
  // for the prefix).
  const matched = fetched.body.toUpperCase().includes(token.toUpperCase());
  if (!matched) {
    return res.status(200).json({
      ok: false,
      verified: false,
      reason: "no_match",
    });
  }

  const updatedPrefs = await markRsiHandleVerified(redis, session.userId);
  return res.status(200).json({ ok: true, verified: true, prefs: updatedPrefs });
}
