# Plan: Add Unit Tests

## Context
The project has no test infrastructure — no test runner, no test files, no test config. This plan adds a focused unit test suite covering the most valuable, testable logic without requiring Redis, QStash, Discord, or any environment variables.

## Test Runner: Vitest

Vitest is the natural fit — it shares the existing Vite config, requires minimal setup, and supports ESM natively.

---

## What to Test

### `src/refineryConfig.js` — highest value, all functions already exported
- `formatRefineryDuration(totalSeconds)` — "16h 0m", "20m 0s", "0s" edge cases
- `secondsToMinutes(totalSeconds)` — rounding, zero/negative inputs
- `computeMethodCostAndTime({ scu, methodName })` — linear scaling from baseline
- `getRefineryLocation(name)` — lookup + fallback to first entry
- `getRefineryMaterial(name)` — same
- `getRefineryMethod(name)` — same
- `getMaterialMaxBaseRate(name)` — returns 0 for unknown material
- `getLocationBonusRate(location, materialName)` — percent-to-decimal conversion, missing bonus
- `getMethodYieldMultiplier(method)` — 0..1 relative to max yield
- `computeRefineryJob({ scu, materialName, methodName, locationName })` — full breakdown; verify linearity and location bonus application

### `api/_lib/session.js` — all pure helpers
- `parseCookies(header)` — empty, single, multi, URL-encoded, malformed
- `buildCookie(name, value, opts)` — flags, maxAge, sameSite, Secure absent in non-production
- `generateToken()` — 64 hex chars, unique across calls

### `api/_lib/discord.js`
- `buildAuthorizeUrl({ clientId, redirectUri, state, scope, extra, prompt })` — correct params in URL, extra fields forwarded, scope defaults to "identify"

### `api/_lib/prefs.js`
- `defaultPrefs()` — returns expected defaults
- `sanitizePrefsUpdate(input)` — accepts boolean `discordNotifications`; drops unknown fields; rejects non-boolean; clients cannot set `notificationLinkedAt`

### `api/_lib/discordBot.js`
- `explainDmFailure(failure)` — maps error codes/statuses to friendly strings; returns null for ok=true or unknown errors

### `api/prices.js`
- `median(nums)` — empty, odd, even arrays; handles duplicates
- `buildPublicView(dataMap)` — transforms internal format; skips empty entries; calculates median, count, lastReportedAt

### `api/ledger.js`
- `sanitizeRefineryJob(j)` — required fields, numeric validation, string truncation, null returns for invalid; new fields: `method`, `materialScu`, `notifiedAt`, `notificationStatus`, `notificationMessageId`
- `sanitizeSellOrder(o)` — same pattern

### What NOT to test (yet)
- Redis, QStash, Discord API calls — require real credentials or complex mocking
- Auth endpoint handlers — tightly coupled to external services
- React component rendering — high setup cost for this app

---

## Implementation Steps

### 1. Install Vitest
```
npm install --save-dev vitest
```

### 2. Update `vite.config.js`
```js
test: {
  environment: 'node',
  globals: true,
}
```

### 3. Add scripts to `package.json`
```json
"test": "vitest run",
"test:watch": "vitest"
```

### 4. Export functions not currently exported

| File | Functions to export |
|------|---------------------|
| `api/prices.js` | `median`, `buildPublicView` |
| `api/ledger.js` | `sanitizeRefineryJob`, `sanitizeSellOrder` |
| `api/_lib/session.js` | already exported — no change |
| `api/_lib/discord.js` | already exported — no change |
| `api/_lib/prefs.js` | already exported — no change |
| `api/_lib/discordBot.js` | already exported — no change |
| `src/refineryConfig.js` | already exported — no change |

### 5. Create test files

```
src/__tests__/refineryConfig.test.js    ← biggest coverage win
api/__tests__/session.test.js
api/__tests__/discord.test.js
api/__tests__/prefs.test.js
api/__tests__/discordBot.test.js
api/__tests__/prices.test.js
api/__tests__/ledger.test.js
```

---

## Files to Modify

| File | Change |
|------|--------|
| `package.json` | Add vitest devDependency + test scripts |
| `vite.config.js` | Add `test` block |
| `api/prices.js` | Export `median` and `buildPublicView` |
| `api/ledger.js` | Export `sanitizeRefineryJob` and `sanitizeSellOrder` |

## New Files

| File | Key test cases |
|------|----------------|
| `src/__tests__/refineryConfig.test.js` | All 10 exported helpers; verify location bonus, method scaling, fallbacks |
| `api/__tests__/session.test.js` | parseCookies, buildCookie, generateToken |
| `api/__tests__/discord.test.js` | buildAuthorizeUrl with all option combinations |
| `api/__tests__/prefs.test.js` | defaultPrefs, sanitizePrefsUpdate |
| `api/__tests__/discordBot.test.js` | explainDmFailure code/status mappings |
| `api/__tests__/prices.test.js` | median, buildPublicView, edge cases |
| `api/__tests__/ledger.test.js` | sanitizeRefineryJob, sanitizeSellOrder including new notification fields |

---

## Verification

Run `npm test` — expect ~40-50 tests across 7 files, all passing with no network calls or environment variables required.
