# SCSalvager Desktop — Plan

Native desktop client for [scsalvager.net](https://scsalvager.net). Reuses
the existing Vercel + Upstash backend; adds OS-native capabilities the
browser can't reach (system tray, OS notifications, global hotkeys,
screenshot capture from the Star Citizen window).

## Stack

**Tauri 2** — Rust backend + system WebView frontend. ~10 MB bundle.
Reuses the existing React/Vite codebase via remote URL load (Phase 1) or
embedded build (Phase 5+).

Alternatives considered + rejected:

- **Electron** — 150 MB bundle, ships its own Chromium per app.
- **Installable PWA** — no global hotkeys, no system tray.
- **MAUI / Avalonia** — would mean rewriting `src/App.jsx` in XAML.

## Phases

### Phase 1 — Shell + auth (this scaffold)

- Tauri scaffold with main window pointed at
  `https://scsalvager.net/api/auth/desktop-callback`.
- Deep-link scheme `scsalvager://` registered via
  `tauri-plugin-deep-link`.
- `tauri-plugin-single-instance` collapses duplicate launches.
- Rust handler parses `scsalvager://auth?token=<sessionToken>`,
  injects the token as a `scs_session` cookie into the WebView,
  reloads to the site root.

Server changes (already landed):

- `GET /api/auth/desktop-callback` — OAuth bridge endpoint.
- `getSession()` accepts `Authorization: Bearer <token>` as a
  cookie fallback (for Rust background polls outside the WebView).

Deliverable: Tauri window that ships the existing site, signed in.

### Phase 2 — Native UX

- System tray icon with refinery countdown badge (next-pickup ETA
  pulled from `/api/ledger`).
- OS toast notifications when a refinery job hits Ready.
- Native file picker for screenshot upload (drag/drop fallback
  on web).
- Background poll service (Tauri Tokio task) every 30 s for inbox
  + ready jobs even when window minimized. Authenticates via
  the Bearer fallback in `getSession`.

Tauri plugins: `tauri-plugin-notification`, `tauri-plugin-dialog`,
`tauri-plugin-shell` (open browser for external links).

### Phase 3 — In-game integration

- Global hotkey: capture the Star Citizen window and POST it to
  `/api/refinery/analyze` in one keystroke. Plugin:
  `tauri-plugin-global-shortcut`.
- Screenshot capture: Windows `BitBlt` via `windows` crate, macOS
  `CGDisplay`, Linux `xcap` crate.
- Optional always-on-top overlay window for refinery countdown +
  new admin announcements.

### Phase 4 — Distribution + auto-update

- GitHub Actions matrix build: Windows MSI + NSIS, macOS DMG
  (signed + notarized), Linux AppImage + DEB.
- `tauri-plugin-updater` with GitHub Releases as the update
  channel. App polls release feed, prompts on new version.
- Code signing: Windows EV cert, Apple Developer ID
  (~$99/yr + ~$200/yr). Linux unsigned per community standard.

### Phase 5 — Polish (optional)

- Discord Rich Presence ("Refining 1,024 SCU at Levski · 4h 12m
  remaining") via `discord-presence` crate.
- Local SQLite cache for offline ledger view (read-only when API
  unreachable).
- Local screenshot crop UI before upload.
- DPS-overlay-style ledger summary for crew salvage runs.

## Risks

- **macOS notarization** — needs active Apple Developer account.
  Skip for v1; Mac users see "unidentified developer" warning.
- **Star Citizen capture across DRM** — SC uses EAC. Standard
  desktop-capture APIs work since we capture from outside the
  game process; verify on real install during Phase 3.
- **WebView2 install on older Windows** — Win10 1809+ ships it.
  Tauri can bundle the installer if missing (+1.5 MB).
- **Code-sign cert cost** — Windows EV cert ~$200/yr to avoid
  SmartScreen warning. Worth it for download conversion.

## Estimate

| Phase | Scope | Effort |
|-------|-------|--------|
| 1 | Shell + auth | 1–2 weeks |
| 2 | Tray + notifications + background poll | 2 weeks |
| 3 | Hotkeys + overlay + SC capture | 3 weeks |
| 4 | CI + signing + auto-update | 1 week |

**First useful release: ~7 weeks.** Phase 1 alone is shippable in
~2 weeks for early-tester traffic.
