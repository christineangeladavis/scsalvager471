# SCSalvager Desktop — Release Notes

Native Tauri shell wrapping scsalvager.net with system tray, refinery countdown
badge, screenshot capture from the tray, OS toasts, deep-link OAuth, offline
ledger cache, compact + crew-salvage overlay widgets, and an auto-updater.

Ships for Windows (MSI / NSIS), macOS (Apple Silicon DMG), and Linux (AppImage,
deb). Auto-update endpoint: `/api/desktop/manifest` (served by scsalvager.net).

---

## v0.2.9

### Changed
- **Launch-time update check now prompts via the in-app modal.** When you
  open the app, the 15-second post-launch updater check no longer
  silently downloads + toasts. If a new version is available the
  Update Available modal opens with **Update Now** / **Later** buttons.
  No popup at all if you're already on the latest version. The tray
  "Check for updates…" item behaves the same as before.

---

## v0.2.8

### Changed
- **Release artifacts use a canonical naming convention** from this
  version forward:
  `SCSalvager-Desktop-<os-label>_v<version><suffix>`
  (e.g. `SCSalvager-Desktop-windows-x86_64_v0.2.8-setup.exe`). The
  Settings → Desktop App download buttons and the auto-updater both
  resolve the new + legacy names so older releases still install
  cleanly.

---

## v0.2.7

### Added
- **Clear All Ledgers** admin button (visible in the web view's Admin
  Panel → All Users header) that soft-clears every user's refinery
  jobs + sell orders behind a 2-step confirmation. Useful for the
  patch-advance cleanup on a new SC release.

### Fixed
- Admin **All Users** header layout — title now sits on its own row
  above the action buttons; action row wraps cleanly on narrower
  windows.

---

## v0.2.6

### Added
- **In-app update modal** when clicking the tray's "Check for updates…" item.
  Five states drive the UI: *up to date* shows "You are running the latest
  version of SCSalvager Desktop", *available* surfaces the new version plus an
  **Update Now** button, *downloading* renders a live progress bar (percent +
  KB / KB), *ready* confirms the install and restarts the app, *error*
  surfaces the underlying message.

### Changed
- Tray's manual update check no longer fires OS toast notifications — feedback
  routes through the modal instead, with the window auto-shown/focused even
  if the app was minimised to tray. Launch-time auto-check still uses OS
  notifications + silent background download (changed again in v0.2.9 —
  launch-time also goes through the modal now).

---

## v0.2.5

### Added
- **Version in window titlebar** — the main window title now reads
  `SCSalvager Desktop v<version>`, set at runtime from `CARGO_PKG_VERSION`
  so future bumps update automatically.
- **Admin tables fill the window height** — Admin Panel → All Users,
  Guest Logins, and the Missions table now use `max-height: calc(100vh - 12rem)`
  in the desktop shell so the scrollable region grows with the window
  instead of being capped at a fixed rem floor. Web users keep the
  prior fixed heights.

---

## v0.2.4

### Added
- **Split tray capture into Refinery + Commodity** — the tray right-click
  menu now offers two distinct screenshot triggers:
  - *Capture refinery screenshot* — only accepts in-game refinery setup
    screens. Returns a clear error if the screenshot isn't a refinery
    panel.
  - *Capture commodity sale screenshot* — only accepts in-game commodity
    terminal screens. Returns a clear error otherwise.
- **Screen-type validation** server-side. `/api/refinery/analyze` and
  `/api/sell/analyze` instruct the vision model to verify signature
  headers ("REFINERY SYSTEM" / "REFINEMENT CENTER" vs "COMMODITIES" /
  "YOUR INVENTORIES" / "IN DEMAND") before extracting. Wrong-type
  screenshots return `422 not_refinery` / `not_commodity` with a
  user-readable message.

---

## v0.2.3

### Added
- **Frameless overlay widget** — `#compact` and `#crew-widget` modes
  now run with the OS titlebar removed (`set_decorations(false)`) so
  the widget sits cleanly on top of Star Citizen.
- **Drag handle** — slim bar at the top of each widget mode uses CSS
  `-webkit-app-region: drag` so users can grab any inch to move the
  frameless window around. Close (✕) button on the bar exits widget
  mode.
- **Always-on-top** stays enabled in widget mode for borderless-windowed
  Star Citizen overlay (already shipped, unchanged here).

### Changes
- Widget window dropped to **240×180 min-size** from the full-app
  980×640 floor, with the React side rescaling text + controls
  proportionally via CSS zoom (baseline 420px crew / 380px compact,
  clamp 0.7..2.5).

---

## v0.2.2

### Added
- **"Check for updates…" tray menu item** sitting above Quit. Triggers
  a manual updater check that surfaces all three outcomes (up to date /
  new version downloading / check failed) so the user gets feedback
  after clicking. Launch-time silent check is untouched.

### Refactors
- Pulled the update flow into `run_update_check(app, manual)` so both
  the launch-time path and the manual tray-triggered path share one
  async function with a flag controlling notification verbosity.

---

## v0.2.1

### Added
- **Resizable widget windows** — `#compact` and `#crew-widget` modes
  now ship with `set_min_size(240, 180)` on entry and restore
  `set_min_size(980, 640)` on exit. `resizable` was already true in
  `tauri.conf.json`, so users can drag the corner to any size between
  240×180 and the screen edge.
- **Proportional text scaling** — React widget root applies inline
  `style={{ zoom: widgetScale }}` recomputed on every `resize` /
  `hashchange`, so px-literal Tailwind classes (`text-[10px]`,
  `h-3`, etc) scale uniformly with the window. Baseline 420px for
  the crew widget, 380px for compact; clamp 0.7..2.5.

---

## v0.2.0 — Initial Release

### Added
- **Native shell** for Windows / macOS (Apple Silicon) / Linux wrapping
  scsalvager.net via Tauri 2 + WebView.
- **System tray** with quick actions: capture refinery screenshot,
  show/hide window, toggle compact mode, toggle crew salvage widget,
  Quit. Left-click toggles visible/hidden.
- **Refinery countdown badge** — Rust background poll (`30s`) hits
  `/api/ledger` and writes the next-pickup ETA into the tray tooltip
  so users can see status without opening the window.
- **OS toasts when a refinery job completes** — fires once per job
  via the tracked `tray_state` so the user doesn't get duplicate
  pings on every poll.
- **F9 global hotkey** for refinery screenshot capture (best-effort —
  Easy Anti-Cheat blocks low-level keyboard hooks while Star Citizen
  is focused, so the tray menu item is the reliable fallback). Hotkey
  + tray click both route through the same xcap-based capture
  pipeline.
- **Tray screenshot capture** uses xcap to grab the Star Citizen
  window pixels even when SC is backgrounded (Windows BitBlt against
  the window backbuffer), hands the PNG off to the existing web
  crop modal for drag-select + upload to `/api/refinery/analyze`.
- **Deep-link OAuth** — `scsalvager://` scheme registered at install
  time; `single-instance` plugin ensures repeat OAuth callbacks
  reuse the existing window instead of spawning new processes.
- **Compact mode** (`#compact` hash) — stripped refinery-countdown
  card, always-on-top, smaller window. Toggle from the tray.
- **Crew Salvage widget** (`#crew-widget` hash) — always-on-top mini
  panel with the active crew session's running SCU totals, role
  list, and split aUEC estimate.
- **Auto-updater** (`tauri-plugin-updater`) — 15s grace period after
  launch, then a silent check against `/api/desktop/manifest`. New
  versions download in the background; install applies on next quit
  + reopen. Minisign-signed releases for authenticity.
- **Offline ledger cache** — the background poll mirrors the most
  recent `/api/ledger` payload into `window.__SCSALVAGER_DESKTOP__.ledgerCache`
  so the web bundle can read it if the network drops mid-session.
