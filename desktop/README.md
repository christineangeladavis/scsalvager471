# SCSalvager Desktop

Tauri 2 shell wrapping [scsalvager.net](https://scsalvager.net) with native
tray, hotkeys, OS notifications, and screenshot capture from the Star
Citizen window.

Built on top of the existing Vercel + Upstash backend — the desktop app
talks to the same `/api/*` endpoints as the web client. No backend rewrite.

## Status

Phase 1 scaffold. Ships an OS-window WebView pointed at the
`/api/auth/desktop-callback` bridge so first launch lands signed in.

Roadmap (see `desktop/PLAN.md`):

- **Phase 1** ✅ scaffold — Tauri config, deep-link OAuth bridge.
- **Phase 2** — system tray + OS notifications + native screenshot picker
  + background refinery poller.
- **Phase 3** — global hotkeys + Star Citizen window capture + optional
  always-on-top overlay.
- **Phase 4** — auto-updater + signed installers (Windows MSI, macOS DMG,
  Linux AppImage) + GitHub Actions matrix build.

## One-time setup

1. Install Rust (rustup): <https://rustup.rs/>
2. Install platform deps:
   - **Windows**: WebView2 Runtime (preinstalled on Win10 1809+, otherwise
     <https://developer.microsoft.com/microsoft-edge/webview2/>)
   - **macOS**: Xcode Command Line Tools (`xcode-select --install`)
   - **Linux**: `sudo apt install libwebkit2gtk-4.1-dev libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev`
3. Install npm deps:
   ```
   cd desktop
   npm install
   ```

## Dev

```
cd desktop
npm run dev
```

Opens a Tauri window pointed at `https://scsalvager.net/api/auth/desktop-callback`.
First launch will redirect through Discord OAuth, then deep-link
`scsalvager://auth?token=…` back into the app. Subsequent launches reuse
the session cookie and land directly on the site.

## Build

```
cd desktop
npm run build
```

Outputs platform-native installers to `desktop/src-tauri/target/release/bundle/`.
Targets are configured in `tauri.conf.json` → `bundle.targets`.

## Architecture

```
Tauri WebView (system browser engine, ~10 MB bundle)
   └── points at https://scsalvager.net inside an OS window
   └── deep-link scheme `scsalvager://auth?token=…` → Rust handler
       → injects session cookie into WebView → reload main page

Rust backend (src-tauri/src/lib.rs):
   - tauri-plugin-deep-link: registers scsalvager:// URI scheme
   - tauri-plugin-single-instance: collapses dupes from extra clicks
   - Phase 2+: tray, hotkeys, notifications, background API poller
```

## Server-side hooks

The web backend gained two additions to support the desktop client:

- `GET /api/auth/desktop-callback` — bridge endpoint that completes the
  Discord OAuth round-trip and redirects to `scsalvager://auth?token=…`
  for the desktop deep-link handler.
- `Authorization: Bearer <session>` is now accepted by `getSession` as a
  fallback to the cookie path, so Rust background polls outside the
  WebView can authenticate without a cookie jar.

Both backwards-compatible — the web client is unaffected.

## Icon placeholders

`src-tauri/icons/` is referenced by `tauri.conf.json` but not yet
populated. Drop in the standard Tauri icon set before the first
`npm run build`:

- `32x32.png`, `128x128.png`, `128x128@2x.png`
- `icon.ico` (Windows), `icon.icns` (macOS)

Generate via:

```
npx @tauri-apps/cli icon path/to/source.png
```
