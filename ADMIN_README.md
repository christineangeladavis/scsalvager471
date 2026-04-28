# Admin Panel Changelog

Internal log of every change shipped to the Admin Panel since the tab launched. Production users never see this file. Append a dated bullet whenever the admin surface gains a feature, loses one, or shifts behavior.

## Access model

- Tab is gated by `user?.isAdmin || import.meta.env.DEV` everywhere it appears (tab list, sub-section dispatch, dev mock).
- `isAdminSession()` (`api/_lib/admin.js`) admits the configured admin Discord IDs plus a hard-coded fallback (`125372743637008384`) so the owner can never be locked out by env-var failure.
- Every admin API endpoint runs three guards in order: `getSession` → `isAdminSession` → handler.

## Sub-sections

| Tab id            | Label                  | Backed by                                    |
|-------------------|------------------------|----------------------------------------------|
| `refineries`      | Active Refineries      | `GET /api/admin/active-refineries`           |
| `users`           | All Users              | `GET /api/admin/users`                       |
| `exports`         | Patch Exports          | `GET /api/admin/patches`, `GET /api/admin/export` |

---

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
