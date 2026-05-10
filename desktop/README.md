# SCSalvager Desktop

Tauri 2 shell wrapping [scsalvager.net](https://scsalvager.net) with native
tray, hotkeys, OS notifications, and screenshot capture from the Star
Citizen window.

Built on top of the existing Vercel + Upstash backend — the desktop app
talks to the same `/api/*` endpoints as the web client. No backend rewrite.

## Status

Phase 3 shipped. SCSalvager Desktop runs as a native window pointed at
scsalvager.net with system tray, OS toasts, background refinery poller,
F9 / tray-menu screenshot capture for the in-game refinery setup screen,
and a Tauri auto-updater that pulls signed installers from GitHub
Releases via `/api/desktop/manifest`.

Roadmap (see `desktop/PLAN.md`):

- **Phase 1** ✅ — scaffold + deep-link OAuth bridge.
- **Phase 2** ✅ — system tray + OS notifications + 30 s background poll.
- **Phase 3a** ✅ — global hotkey + xcap window capture + upload to
  `/api/refinery/analyze` (Tray menu fallback for in-game capture
  because EAC blocks low-level keyboard hooks).
- **Phase 3b** ✅ — `tauri-plugin-updater` + `/api/desktop/manifest`
  endpoint that resolves GitHub Releases per platform.
- **Phase 3c** ✅ — GitHub Actions matrix workflow
  (`.github/workflows/desktop-release.yml`) builds Win MSI / macOS
  DMG / Linux AppImage on tag push.

## Windows SmartScreen / "not safe" warning

Unsigned Windows binaries trigger the SmartScreen "Windows protected
your PC" prompt on first launch. Two fixes:

### Long-term: Authenticode code-signing certificate

Eliminates the warning entirely.

1. Buy a code-signing cert. Three tiers:
   - **OV (Organization Validation)** ~$100–200/yr (Sectigo, DigiCert).
     Cheaper, but SmartScreen may still warn until your binary
     accumulates reputation (~thousands of installs over weeks).
   - **EV (Extended Validation)** ~$300–500/yr. Hardware token
     ships physically. SmartScreen passes immediately on first
     install. Best UX.
   - **Azure Trusted Signing** ~$10/month flat (Microsoft).
     Cloud-hosted signing service, no token to manage.
2. Export the cert as a password-protected `.pfx` file.
3. Base64-encode the `.pfx`:
   ```powershell
   $bytes = [IO.File]::ReadAllBytes("C:\path\to\cert.pfx")
   [Convert]::ToBase64String($bytes) | Set-Clipboard
   ```
4. Add to GitHub Actions secrets (Settings → Secrets and
   variables → Actions):
   - `WINDOWS_CERTIFICATE` = the base64 string from step 3
   - `WINDOWS_CERTIFICATE_PASSWORD` = the .pfx export password
5. Push a new `desktop-v*` tag. tauri-action picks up the secrets
   automatically and signs the .msi + .exe.

### Short-term: User workaround

Until a cert is in place, instruct downloaders:

> When you run the installer, Windows will show "Windows protected
> your PC". Click **More info** → **Run anyway**. You only need to
> do this once — subsequent updates auto-apply via the in-app
> updater.

Document the workaround on the download landing page on
scsalvager.net and in the GitHub Release body.

## macOS Gatekeeper / "unidentified developer" warning

Same situation on macOS: unsigned `.dmg` triggers the "cannot be
opened because the developer cannot be verified" alert.

Fix: Apple Developer Program ($99/yr). Add these GitHub Actions
secrets:
- `APPLE_CERTIFICATE` (base64-encoded .p12)
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_SIGNING_IDENTITY` (e.g. "Developer ID Application: Your Name (TEAMID)")
- `APPLE_ID` (your Apple ID email)
- `APPLE_PASSWORD` (an app-specific password from appleid.apple.com)
- `APPLE_TEAM_ID`

User workaround in the meantime: right-click the .app → Open →
Open. Confirm the "unidentified developer" prompt once.

## Signed releases — one-time setup

The updater pipeline is wired but won't sign anything until the
operator populates the signing key. Steps (one-time, ~5 minutes):

1. Generate a minisign keypair locally:
   ```powershell
   cd desktop
   npx tauri signer generate -w "$env:USERPROFILE\.tauri\scsalvager.key"
   ```
   The command prints a public key block + writes the private key
   (encrypted with a password you provide) to the path above.

2. Paste the public key into `desktop/src-tauri/tauri.conf.json` →
   `plugins.updater.pubkey`, replacing `PLACEHOLDER_REPLACE_WITH_OUTPUT_OF_TAURI_SIGNER_GENERATE`.

3. Add the private key + password as GitHub Actions secrets
   (Settings → Secrets and variables → Actions):
   - `TAURI_SIGNING_PRIVATE_KEY` — contents of
     `~/.tauri/scsalvager.key` (the file written in step 1)
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — the password you
     entered during generation

4. Cut a release:
   ```powershell
   git tag desktop-v0.2.0
   git push origin desktop-v0.2.0
   ```
   The GitHub Actions workflow builds Win/macOS/Linux installers,
   signs each with your private key, and uploads them + `.sig`
   sibling files to a new GitHub Release.

5. Running desktop apps poll `/api/desktop/manifest` 15 s after
   launch, see the new version, fetch the signed installer,
   verify against the embedded public key, and prompt the user
   to quit + reopen.

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
