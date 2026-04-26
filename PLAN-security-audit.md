# Plan: Security Hardening

## Context
A full audit of the codebase (including the notification/QStash/Discord bot layer added in the latest pull) identified 11 issues ranging from medium to low severity. None are critical, but several are cheap to fix and meaningful. Issues are ordered by priority.

---

## Issues & Fixes

### 1. Missing Security Headers — Medium | Effort: Low
**File:** `vercel.json`

No HTTP security headers are set anywhere. Adds CSP, X-Frame-Options, X-Content-Type-Options, and Referrer-Policy.

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=()" },
        { "key": "Content-Security-Policy", "value": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://cdn.discordapp.com; connect-src 'self'; frame-ancestors 'none'" }
      ]
    }
  ]
}
```

Note: `unsafe-inline` is required for Vite's injected styles. Tighten CSP if the build ever supports nonces.

---

### 2. Host Header Injection in OAuth redirect_uri — Medium | Effort: Low
**File:** `api/_lib/discord.js:71-75` (`getOrigin`)

`getOrigin()` constructs the OAuth redirect base from `x-forwarded-host`/`host` headers with no validation. This function is used by:
- `api/auth/login.js` — login OAuth flow
- `api/auth/notifications-link.js` — notifications link flow
- `api/ledger.js` — building the `deliverUrl` for QStash callbacks

A spoofed host header could redirect OAuth codes to an attacker-controlled server or point QStash delivery callbacks at an external URL.

**Fix:** Use a `SITE_URL` env var as the authoritative origin, falling back to the header only if unset.

```js
export function getOrigin(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL;
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const proto = req.headers["x-forwarded-proto"] || (host && host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
```

Set `SITE_URL=https://yourdomain.com` in Vercel environment variables.

---

### 3. Unauthenticated Price Reporting / No Rate Limiting — Medium | Effort: Medium
**File:** `api/prices.js`

`POST /api/prices` requires no login. Anyone can spam reports and manipulate community prices despite the median window.

**Recommended fix (Option A):** Require an active session — return 401 if not logged in. Matches the ledger/prefs endpoint pattern and is the right fit since this is a community feature for logged-in players.

---

### 4. Test Notification Endpoint Has No Rate Limiting — Low/Medium | Effort: Low
**File:** `api/notifications/test.js`

`POST /api/notifications/test` sends a real Discord DM on every request. A script could spam this endpoint to flood a user's Discord DMs. The endpoint is authenticated, so only self-spam is possible, but it's still a nuisance.

**Fix:** Add a Redis-backed cooldown (e.g., one test DM per user per 60 seconds):

```js
const cooldownKey = `notif-test-cooldown:${session.userId}`;
const recent = await redis.get(cooldownKey);
if (recent) {
  return res.status(429).json({ ok: false, error: "Please wait before sending another test." });
}
await redis.set(cooldownKey, 1, { ex: 60 });
```

---

### 5. GET Logout Allows CSRF Logout — Low | Effort: Low
**File:** `api/auth/logout.js:8`

GET is accepted for logout. Any third-party page can silently log users out via `<img src="/api/auth/logout">`.

**Fix:** Remove `GET` from the allowed methods. Use POST only for the logout button.

```js
if (req.method !== "POST") {
  res.setHeader("Allow", "POST");
  return res.status(405).json({ error: "Method not allowed" });
}
// ... delete session, clear cookie, return { ok: true }
```

---

### 6. Error Messages Leak Internal Details — Low | Effort: Low
**Files:** `api/auth/callback.js`, `api/auth/notifications-link.js:31`, multiple 503 responses

Redis and Discord error messages are forwarded verbatim to HTTP response bodies and could expose credential details or infrastructure URLs.

```js
// Instead of:
res.status(503).send("Storage unavailable: " + e.message);

// Do:
console.error("Storage unavailable:", e);
res.status(503).send("Storage unavailable. Please try again later.");
```

Apply to all `catch` blocks that include `e.message` in a client-visible response.

---

### 7. `LEDGER_KEY_PREFIX` Hardcoded in `deliver.js` — Low | Effort: Low
**Files:** `api/notifications/deliver.js:31`, `api/ledger.js:16`

Both files independently define the Redis key format for ledger data:
- `api/ledger.js`: `function ledgerKey(userId) { return \`ledger:${userId}\`; }`
- `api/notifications/deliver.js`: `const LEDGER_KEY_PREFIX = "ledger:";`

If the key format ever changes, the deliver endpoint would silently fail to find ledger data.

**Fix:** Export `ledgerKey` from `ledger.js` and import it in `deliver.js`, or move it to a shared lib file.

---

### 8. Duplicate Redis Client in `prices.js` — Low | Effort: Low
**File:** `api/prices.js:28-53`

The entire Redis init block is copy-pasted from `api/_lib/redis.js`. Any future fix to the shared lib won't apply here.

**Fix:** Remove the local copy and import from the shared lib:

```js
import { getRedis } from "./_lib/redis.js";
```

---

### 9. `parseFloat` Accepts Partial Strings as Prices — Low | Effort: Low
**File:** `api/prices.js:118`

`parseFloat("150000xss")` silently returns `150000`. Use `Number()` which returns `NaN` for non-numeric strings and correctly fails validation.

```js
// Change:
const priceNum = typeof body.price === "number" ? body.price : parseFloat(body.price);
// To:
const priceNum = Number(body.price);
```

---

### 10. Ledger GET Returns Redis Data Without Re-sanitization — Low | Effort: Low
**File:** `api/ledger.js:88-98`

Data is sanitized on write (POST) but returned raw on read (GET). Pass GET responses through the same sanitizers as defense-in-depth.

```js
const raw = (await redis.get(key)) || { refineryJobs: [], sellOrders: [] };
return res.status(200).json({
  refineryJobs: Array.isArray(raw.refineryJobs)
    ? raw.refineryJobs.map(sanitizeRefineryJob).filter(Boolean)
    : [],
  sellOrders: Array.isArray(raw.sellOrders)
    ? raw.sellOrders.map(sanitizeSellOrder).filter(Boolean)
    : [],
});
```

---

### 11. Session Cookie SameSite=Lax vs Strict — Low | Effort: Low
**File:** `api/auth/callback.js:64-67`

The session cookie uses `SameSite=Lax`. `Strict` would prevent the cookie from being sent on any cross-site navigation, reducing CSRF surface. Since the session is set fresh in the callback response itself, switching to `Strict` shouldn't break the OAuth redirect.

```js
buildCookie(SESSION_COOKIE, sessionToken, { maxAge: SESSION_TTL_SECONDS, sameSite: "Strict" })
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `vercel.json` | Add security headers block |
| `api/_lib/discord.js` | Use `SITE_URL` env var in `getOrigin` |
| `api/prices.js` | Require auth on POST; remove duplicate Redis client; fix `parseFloat` |
| `api/auth/logout.js` | Remove GET support |
| `api/auth/callback.js` | Strip error details from 500/503 responses; set `SameSite=Strict` on session cookie |
| `api/auth/notifications-link.js` | Strip error details from 503 response |
| `api/notifications/test.js` | Add Redis-backed rate limit cooldown |
| `api/ledger.js` | Export `ledgerKey`; re-sanitize data on GET |
| `api/notifications/deliver.js` | Import `ledgerKey` from `ledger.js` instead of hardcoding prefix |

---

## Verification

- `GET /api/auth/logout` returns 405
- `POST /api/prices` without a session returns 401
- `POST /api/notifications/test` twice in quick succession returns 429 on the second call
- Response headers on any page include `X-Frame-Options`, `X-Content-Type-Options`, `Content-Security-Policy`
- `Number("150abc")` correctly rejected at price validation
- OAuth login and notification-link flows work end-to-end after `getOrigin` change
