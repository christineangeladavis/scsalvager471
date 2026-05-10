// SCSalvager Desktop — Tauri 2 entry point.
//
// Phase 1: thin shell wrapping scsalvager.net.
//   - Window URL is /api/auth/desktop-callback so first launch goes
//     through the OAuth bridge and lands the user signed in.
//   - tauri-plugin-deep-link registers the `scsalvager://` URI
//     scheme. The callback page hits scsalvager://auth?token=...
//     which we receive here, store, and use to seed the WebView's
//     session cookie via JS injection.
//   - tauri-plugin-single-instance ensures a second launch (e.g.
//     from clicking another deep link) routes to the existing
//     window instead of opening a duplicate.
//
// Phase 2+ adds: system tray, OS notifications, global hotkeys for
// screenshot capture, background refinery poller, auto-updater.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    scsalvager_desktop_lib::run()
}
