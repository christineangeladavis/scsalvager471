# Admin Panel Changelog

Internal log of every change shipped to the Admin Panel since the tab launched. Production users never see this file. Append a dated bullet whenever the admin surface gains a feature, loses one, or shifts behavior.

## Access model

- Tab is gated by `user?.isAdmin || import.meta.env.DEV` everywhere it appears (tab list, sub-section dispatch, dev mock).
- `isAdminSession()` (`api/_lib/admin.js`) admits the configured admin Discord IDs plus a hard-coded fallback (`125372743637008384`) so the owner can never be locked out by env-var failure.
- Every admin API endpoint runs three guards in order: `getSession` → `isAdminSession` → handler.

## Sub-sections

| Tab id            | Label                  | Backed by                                    |
|-------------------|------------------------|----------------------------------------------|
| `users`           | All Users              | `GET /api/admin/users`                       |
| `guests`          | Guest Logins           | `GET /api/admin/guest-logins`                |
| `refineries`      | 7-Day History          | `GET /api/admin/active-refineries`           |
| `exports`         | Patch Exports          | `GET /api/admin/patches`, `GET /api/admin/export` |

Tab order: **All Users → Guest Logins → 7-Day History → Patch Exports**. Default `adminSection` is `"users"` so a fresh admin lands on the user roster.

Modals:
- **All Users → row click** → user-detail modal showing 30-day history. Per-row edit + delete plus per-patch and all-data clear actions. Backed by `GET /api/admin/user-history`, `POST /api/admin/clear-user-ledger`, `POST /api/admin/delete-ledger-entry`, `POST /api/admin/edit-ledger-entry`.

---

## 2026-04-29 — Contracts panel + 5-row scroll caps in the user-detail modal

- New **Contracts** section between the modal header and the Refinery jobs table. Two sub-lists:
  - **Current**: pulled from `prefs.activeContracts` via `GET /api/admin/user-history` (the endpoint now reads the user's prefs hash and includes `activeContracts: [{ missionId, name, reward, buyIn, acceptedAt }, …]` in the response). Empty array on prefs read failure — never fails the whole request.
  - **Completed**: derived client-side by filtering `sellOrders` for `material in {"Mission Reward", "Mission Buy-In"}`. Status pill is set per row: `Reward` (cyan) when material is "Mission Reward", `Buy-In` (rose) when material is "Mission Buy-In", `Abandoned` (rose) when the location string ends in `(abandoned)` (the suffix `abandonMissionContract()` stamps on the synthetic sell order).
- Both Contracts sub-lists cap at `max-h-52` with vertical scroll using the site-standard pill scrollbar utility (`[scrollbar-width:thin] [scrollbar-color:rgb(6_182_212_/_0.7)_rgb(2_6_23)] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-slate-950 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-thumb]:bg-cyan-500/70 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb:hover]:bg-cyan-400`). ~5 rows visible before scroll; older rows still reachable.
- Refinery jobs + Sell orders tables also gain `max-h-[15rem]` with the same vertical scrollbar utility added alongside the existing horizontal scroll on the table wrapper. Header pinned via the natural `<thead>` flow inside the scrolling div.
- Dev-mock fixture (`buildDevMock` in `openAdminUserDetail`) seeds 1 active contract + 1 completed reward + 1 abandoned buy-in for any dev user. The Chrissyy account specifically gets a richer 2 active + 2 completed fixture so the Contracts panel exercises both lists in vite-dev.

---

## 2026-04-28 — Per-row edit + delete in the user-detail modal

- Each row in the user-detail modal's Refinery jobs and Sell orders tables now has an **Edit (✏)** and **Delete (✕)** button.
- **Delete** fires `POST /api/admin/delete-ledger-entry` body `{ userId, kind: "job"|"sale", entryId, confirm: "DELETE_ENTRY" }`. Soft-deletes the single entry, cancels its in-flight QStash schedule if any.
- **Edit** swaps the row to inline input fields backed by `adminEditEntry.draft`, with **Save** + **Cancel**. Save fires `POST /api/admin/edit-ledger-entry` body `{ userId, kind, entryId, patch, confirm: "EDIT_ENTRY" }`. Patch is whitelist-filtered server-side; any non-editable field is dropped silently. Server runs the merged entry through the same `sanitizeRefineryJob` / `sanitizeSellOrder` helper used by `/api/ledger.js` so length caps + numeric coercion stay aligned.
- Editable fields:
  - **Refinery job:** `material`, `materialScu`, `location`, `method`, `yield`, `cost`, `timeMinutes`, `submittedAt`, `completesAt`, `pickedUpAt`.
  - **Sell order:** `material`, `scu`, `location`, `playerName`, `aUEC`, `submittedAt`.
- Shared library: `api/_lib/ledgerOps.js` now exports `softDeleteLedgerEntry` and `editLedgerEntry` alongside `softClearLedger`.

## 2026-04-28 — Per-patch + all-data clear options

- The user-detail modal's Admin actions section now lists a button per released patch (e.g. **Clear patch 4.7.2**, **Clear patch 4.8**) plus a separate **Clear ALL ledger data** option.
- Per-patch: `POST /api/admin/clear-user-ledger` body `{ userId, scope: "patch", patchVersion, confirm: "CLEAR_USER_LEDGER" }`. Server resolves `patchRange(version)` and only soft-deletes entries whose `submittedAt` falls in `[from, to)`. Returns 400 on `scope=patch` without a recognised `patchVersion`.
- All-data: `{ userId, scope: "all", confirm: "CLEAR_USER_LEDGER" }` (legacy default if `scope` is omitted).
- Shared `softClearLedger(redis, userId, opts?)` accepts `{from, to}` to scope the wipe; admin clear-all and the self-service patch reset both call it without a window for "wipe everything".
- Client: inline confirm flow uses a single `adminClearLedgerTarget` state shape `{ kind: "all" | "patch" | "row", patchVersion?, rowKind?, entryId?, label }`. Step 0 = picker visible, step 1 = first confirm, step 2 = last-chance, fire on click.
- The patch list comes from `/api/admin/patches`. The user-detail open handler triggers a fetch when `adminPatches` is null so the buttons appear without the admin first opening the Patch Exports tab. Dev fallback uses the hoisted `devMockPatches()` helper.

## 2026-04-28 — All Users row drill-down + per-user clear ledger

- Clicking any row in **All Users** opens a modal with that user's last 30 days of refinery jobs + sell orders. Backed by `GET /api/admin/user-history?userId=<id>&days=30` (default 30, capped at 365). Soft-deleted entries are filtered out — the admin sees what the user sees.
- Endpoint `POST /api/admin/clear-user-ledger` — soft-deletes scoped entries (see per-patch+all entry above for current scope semantics) and cancels in-flight QStash schedules.
- Implementation in `api/_lib/ledgerOps.js` (`softClearLedger`) is shared between admin clears and the user-self-service patch reset.
- Refused with 404 when `userId` isn't in the user-meta index — prevents typos creating phantom ledger keys via the soft-delete write.
- Vite-dev fallback: when `/api/*` returns the raw JS source instead of JSON, both the success path's content-type sniff and the catch handler fall back to `buildDevMock()` so the modal exercises in preview without a real API. Dev mock seeds 10 refinery jobs + 10 sell orders per user, deterministic per-user-id, spread across ~28 days for variety.

## 2026-04-28 — Guest Logins table cap + dev mock

- Visible row cap raised from 10 → **15** rows; `max-h-[44rem]` on the wrapper. Beyond 15 the table scrolls inside the panel with a sticky `<thead>`.
- Per-element scrollbar Tailwind variants stripped from the wrapper — site-wide `<style>` block in `index.html` now styles every scrollable surface (cyan-500/70 thumb, slate-950 track, pill-shape, hover cyan-400). Single source of truth instead of inlining per table.
- Dev mock seeds **30** anonymous visits spread across ~7 days (newest first), rotating through 10 user-agent strings (Chrome/Edge/Firefox/Safari on Windows/macOS/Linux/iOS/Android/iPad + Opera) and 12 country codes (US/DE/AU/CA/GB/FR/JP/BR/NO/PL/NL/SE) so the 15-row cap + scroll behavior is exercisable in `vite dev`.

## 2026-04-28 — Guest Logins

- New sub-tab between **All Users** and **Patch Exports**.
- Captures anonymous (non-signed-in) visits so admins can see traffic that never made it through the Discord OAuth flow.
- `POST /api/guest-login` is fired once per page mount when no user session is present. Server-side dedupe via the `scs_guest_visit` cookie (24h `Max-Age`, `HttpOnly`, `SameSite=Lax`); the cookie always refreshes so the dedupe window slides forward as the visitor browses, but the Redis write only happens on first hit per window.
- Records `{ ts, ua, country }` to a Redis list `guests:logins` via `LPUSH` + `LTRIM 0 999` (keeps the most recent 1000 entries; older entries drop off on the next write). `country` from `x-vercel-ip-country` when available. **IP is deliberately not collected** — the admin view only needs traffic volume + browser/region, not source addresses.
- Logged-in callers are skipped — their activity is already in `logins:global` / All Users.
- `GET /api/admin/guest-logins` returns the list newest-first, default `limit=200` (capped at 1000 to match the LTRIM bound).
- Client: standard admin sub-tab layout — sticky cyan-thumb scrollbar, sticky `<thead>`, columns: When / Timestamp / Country / User Agent (UA truncated with `title` for hover full-text).
- Dev mock seeds 5 sample anonymous visits (US / DE / AU / CA / GB) so the preview can exercise the table without hitting the API.

## 2026-04-28 — All Users (was Active Users)

- Renamed sub-tab and panel header from **Active Users** → **All Users**.
- Server: dropped the 24-hour `lastLoginAt` cutoff in `api/admin/users.js`. Response now includes every user from `users:index`, not just users who signed in within the last day. Removed `ACTIVE_WINDOW_MS` constant + `activeWindowMs` field from the response payload.
- Client: table wrapper capped at `max-h-[32rem]` with `overflow-y-auto`, sticky `<thead>`, and the cyan-thumb / slate-950-track scrollbar (same style as the public 30-Day History table).
- Sort order unchanged — online users first, then by most recent login.
- Dev mock seeded with 4 sample users (2 online + 2 offline).

## 2026-04-28 — Discord OAuth diagnostic logs

- `/api/auth/login` logs `redirect_uri`, `host`, `x-forwarded-host`, `x-forwarded-proto`, `SITE_URL` for every attempt. Use to debug "Invalid OAuth2 redirect_uri" reports.
- `/api/auth/callback` logs structured context on state-mismatch failures (`hasCode`, `hasQueryState`, `hasCookieState`, `stateMatched`, `host`, `xfh`, `cookieHeaderLen`). No state values logged.
- `/api/auth/notifications-callback` logs `hasSessionCookie`, `hasStateCookie`, `stateMatched`, `host`, `xfh`, `cookieHeaderLen` when the session check fails. Distinguishes a host-mismatch from a real 7-day session expiry.

Vercel logs grep:
```
[oauth/login]
[oauth/callback]
[oauth/notifications-link]
[oauth/notifications-callback]
```

## 2026-04-28 — Canonical-host bounce

- Production `getOrigin()` always returns `https://scsalvager.net` so the OAuth redirect URI is stable regardless of which front (`www.*` / `*.vercel.app` preview) handled the request.
- `/api/auth/login` and `/api/auth/notifications-link` now 302 non-canonical hosts to the canonical equivalent so session + state cookies land on the same host the OAuth callback uses.
- Session cookie issued with `SameSite=Lax` (was `Strict`) so the browser carries it on the cross-site OAuth return trip.

## 2026-04-27 — Force-logout-all

- `POST /api/admin/force-logout-all` SCANs every `session:*` key in Redis and DELs all except the caller's own session. Useful for rolling sessions after a security event.
- Client lives under Active Users → red **Force Logout All** button with a 2-step confirmation modal.
- Dev mock returns a synthetic count when the API is unreachable so the preview can exercise the button.

## 2026-04-27 — Heartbeat / online presence

- `POST /api/me/heartbeat` bumps `lastSeenAt` on the user-meta hash every ~30s while the tab is open and visible.
- `isOnline` flag in `/api/admin/users` is true when `lastSeenAt >= now - 90s` (3 missed beats).
- Status column on the users table renders green "Online" / grey "Offline" pills.

## 2026-04-26 — Patch Exports

- New sub-tab. Lists every Star Citizen patch the site has logged login + refinery data for.
- `GET /api/admin/patches` returns the catalog of patch windows.
- `GET /api/admin/export?patch=<id>&kind=refineries|sales|logins` streams a CSV. Frontend offers Refineries / Sells / Logins downloads per patch.
- GitHub Actions release-announce + post-message workflows bumped to Node 24-native action versions to match the runtime.

## 2026-04-25 — Active Refineries (initial)

- Tab launched. `GET /api/admin/active-refineries` walks the user index and returns every in-progress refinery job + recent sell order across all users, with per-user grouping.
- Updates auto-refresh when the tab is open.
- Filterable in-table search.

---

## Conventions when editing this file

- Date headings use `YYYY-MM-DD` so `git diff` reads chronologically.
- Newest entry on top.
- One section per shipped change; cross-link the relevant API endpoint and the client surface.
- Don't include user-facing copy here — that's `README.md`.
