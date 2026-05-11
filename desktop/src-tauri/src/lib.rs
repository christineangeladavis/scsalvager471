// SCSalvager Desktop — Tauri 2 application setup.
//
// Phase 1 (shipped):
//   - tauri-plugin-deep-link registers `scsalvager://` URI scheme.
//   - tauri-plugin-single-instance collapses dupes from extra launches.
//   - On deep-link receipt: parse `token=` from the URL and inject it
//     into the WebView as a SESSION cookie + persist to disk so the
//     background poller can read it on next iteration.
//
// Phase 2 (this file):
//   - System tray icon with tooltip showing the next refinery pickup
//     ETA. Left-click toggles the main window; right-click opens a
//     menu (Show / Hide / Quit). Closing the window minimizes to
//     tray instead of exiting.
//   - OS toast notifications fire when a refinery job transitions
//     to Ready (completesAt has passed AND we haven't shown the
//     toast for that id yet).
//   - Background poller (tokio::spawn) hits /api/ledger every 30 s,
//     authenticated via Bearer fallback in api/_lib/session.js.
//     No-op when no session token is on disk.
//
// Phase 3 will add global hotkeys + Star Citizen window capture +
// auto-update via Tauri updater.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use base64::Engine;
use serde::Deserialize;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_updater::UpdaterExt;
use url::Url;

const SESSION_COOKIE: &str = "scs_session";
const SCSALVAGER_ORIGIN: &str = "https://scsalvager.net";
const POLL_INTERVAL_SECS: u64 = 30;
const AUTH_FILE_NAME: &str = "auth.json";
const LEDGER_CACHE_FILE_NAME: &str = "ledger-cache.json";
// Window-title substring used to find the Star Citizen window
// among all visible OS windows. Case-insensitive match. Will
// match "Star Citizen" but not "RSI Launcher".
const SC_WINDOW_TITLE_HINT: &str = "star citizen";

// -----------------------------------------------------------------
// Deep-link handling (Phase 1, untouched).
// -----------------------------------------------------------------

fn extract_token_from_deep_link(raw: &str) -> Option<String> {
    let parsed = Url::parse(raw).ok()?;
    if parsed.scheme() != "scsalvager" {
        return None;
    }
    for (k, v) in parsed.query_pairs() {
        if k == "token" {
            let trimmed = v.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

fn handle_token_received(app: &AppHandle, token: String) {
    // 1. Persist to disk so the background poller picks it up.
    if let Err(e) = write_session_token(app, &token) {
        eprintln!("[deep-link] persist token failed: {e}");
    }

    // 2. Inject into the WebView as a session cookie + reload.
    let Some(window) = app.get_webview_window("main") else {
        eprintln!("[deep-link] main window missing on token receipt");
        return;
    };
    let js = format!(
        r#"
        (function () {{
            var token = {token_json};
            var maxAge = 7 * 24 * 60 * 60;
            document.cookie = '{cookie}=' + encodeURIComponent(token)
                + '; Path=/; Max-Age=' + maxAge
                + '; Secure; SameSite=Lax';
            window.location.href = '{origin}/';
        }})();
        "#,
        token_json = serde_json::to_string(&token).unwrap_or_else(|_| "\"\"".to_string()),
        cookie = SESSION_COOKIE,
        origin = SCSALVAGER_ORIGIN,
    );
    if let Err(e) = window.eval(&js) {
        eprintln!("[deep-link] cookie inject eval failed: {e:?}");
    }
}

// -----------------------------------------------------------------
// Auth-token persistence (used by deep-link write + poll read).
// -----------------------------------------------------------------

fn auth_file_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|d| d.join(AUTH_FILE_NAME))
}

fn write_session_token(app: &AppHandle, token: &str) -> std::io::Result<()> {
    let Some(path) = auth_file_path(app) else {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "app data dir unavailable",
        ));
    };
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let json = serde_json::json!({ "token": token });
    std::fs::write(&path, json.to_string())
}

fn read_session_token(app: &AppHandle) -> Option<String> {
    let path = auth_file_path(app)?;
    let bytes = std::fs::read(&path).ok()?;
    let parsed: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    parsed.get("token")?.as_str().map(|s| s.to_string())
}

// -----------------------------------------------------------------
// Offline ledger cache — Phase 5 #3.
// -----------------------------------------------------------------
// Background poll mirrors every successful /api/ledger response to
// <appData>/ledger-cache.json and pushes the JSON onto the WebView
// bridge via window.__SCSALVAGER_DESKTOP__.ledgerCache. The web
// app reads the bridge value as a fallback whenever the network
// fetch fails (laptop in a tunnel, scsalvager.net down, etc.) so
// the user can browse their last-known ledger state read-only.

fn ledger_cache_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|d| d.join(LEDGER_CACHE_FILE_NAME))
}

fn write_ledger_cache(app: &AppHandle, raw: &str) {
    let Some(path) = ledger_cache_path(app) else { return };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(&path, raw);
    push_ledger_cache_to_webview(app, raw);
}

fn push_ledger_cache_to_webview(app: &AppHandle, raw: &str) {
    let Some(window) = app.get_webview_window("main") else { return };
    // Embed the JSON safely as a string literal — outer
    // serde_json::to_string handles every escape so the eval
    // can't break on quotes / backslashes / newlines in the
    // ledger payload.
    let escaped = match serde_json::to_string(raw) {
        Ok(s) => s,
        Err(_) => return,
    };
    let js = format!(
        r#"
        (function () {{
            var b = window.__SCSALVAGER_DESKTOP__ = window.__SCSALVAGER_DESKTOP__ || {{}};
            b.ledgerCache = {escaped};
            b.ledgerCacheUpdatedAt = Date.now();
        }})();
        "#,
    );
    let _ = window.eval(&js);
}

fn seed_ledger_cache_into_webview(app: &AppHandle) {
    let Some(path) = ledger_cache_path(app) else { return };
    let Ok(raw) = std::fs::read_to_string(&path) else { return };
    push_ledger_cache_to_webview(app, &raw);
}

// Bridge: when the user signs in via the in-WebView Discord OAuth
// flow (the normal path now that the WebView opens at the site
// root), the session cookie lives in Tauri's WebView cookie jar.
// The deep-link path is the only place that previously wrote
// auth.json, so the background poller had no token to use and
// returned 401. This pulls the scs_session cookie out of the
// WebView and mirrors it to disk so the poller can authenticate.
//
// HttpOnly cookies aren't accessible to page JavaScript but ARE
// accessible to the host process via Tauri's cookies API.
fn try_pull_session_from_webview(app: &AppHandle) -> Option<String> {
    let window = app.get_webview_window("main")?;
    let url = Url::parse("https://scsalvager.net/").ok()?;
    let cookies = window.cookies_for_url(url).ok()?;
    cookies
        .into_iter()
        .find(|c| c.name() == SESSION_COOKIE)
        .map(|c| c.value().to_string())
}

fn ensure_session_token(app: &AppHandle) -> Option<String> {
    if let Some(t) = read_session_token(app) {
        return Some(t);
    }
    let pulled = try_pull_session_from_webview(app)?;
    if let Err(e) = write_session_token(app, &pulled) {
        eprintln!("[poll] persist pulled token failed: {e}");
    }
    Some(pulled)
}

// -----------------------------------------------------------------
// Tray icon, tooltip, menu (Phase 2).
// -----------------------------------------------------------------

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let capture_refinery = MenuItem::with_id(
        app,
        "capture_refinery",
        "Capture refinery screenshot",
        true,
        None::<&str>,
    )?;
    let capture_commodity = MenuItem::with_id(
        app,
        "capture_commodity",
        "Capture commodity sale screenshot",
        true,
        None::<&str>,
    )?;
    let sep0 = PredefinedMenuItem::separator(app)?;
    let show = MenuItem::with_id(app, "show", "Show window", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide", "Hide window", true, None::<&str>)?;
    let compact = MenuItem::with_id(
        app,
        "toggle_compact",
        "Toggle compact mode (always on top)",
        true,
        None::<&str>,
    )?;
    let crew_widget = MenuItem::with_id(
        app,
        "toggle_crew_widget",
        "Toggle crew salvage widget (always on top)",
        true,
        None::<&str>,
    )?;
    let sep_update = PredefinedMenuItem::separator(app)?;
    let check_updates = MenuItem::with_id(
        app,
        "check_updates",
        "Check for updates…",
        true,
        None::<&str>,
    )?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &capture_refinery,
            &capture_commodity,
            &sep0,
            &show,
            &hide,
            &compact,
            &crew_widget,
            &sep_update,
            &check_updates,
            &sep,
            &quit,
        ],
    )?;

    // Embed the PNG at compile time. default_window_icon() returns
    // None when no `icon` field is set on the window in
    // tauri.conf.json (bundle.icon is only used by the installer
    // bundler, not the running window). Embedding via
    // tauri::include_image! guarantees the tray always has an icon.
    let icon: Image<'_> = tauri::include_image!("icons/icon.png");

    TrayIconBuilder::with_id("main")
        .icon(icon)
        .tooltip("SCSalvager · idle")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "capture_refinery" => {
                // EAC blocks the F9 global hotkey while Star
                // Citizen has focus, so the tray menu acts as
                // the reliable capture trigger. xcap reads the
                // SC window's pixels even when SC is backgrounded
                // (Windows BitBlt against the window's backbuffer
                // works for non-focused windows), so the user
                // only needs to alt-tab once + click this item.
                handle_screenshot_hotkey(app.clone(), CaptureKind::Refinery);
            }
            "capture_commodity" => {
                // Same capture pipeline; the web bridge routes the
                // image to /api/sell/analyze instead of /refinery
                // based on the bridge method name (openCommodityCrop).
                handle_screenshot_hotkey(app.clone(), CaptureKind::Commodity);
            }
            "show" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.unminimize();
                    let _ = w.set_focus();
                }
            }
            "hide" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
            }
            "toggle_compact" => {
                toggle_widget_mode(app, "#compact", 380.0, 220.0);
            }
            "toggle_crew_widget" => {
                // Crew salvage live summary widget — bigger than
                // compact because it has more rows (3 SCU
                // buckets + per-role contribution + split aUEC).
                toggle_widget_mode(app, "#crew-widget", 420.0, 320.0);
            }
            "check_updates" => {
                // Manual updater check from the tray menu. Unlike
                // the launch-time silent check, this surfaces both
                // "up to date" and "downloading new version" via
                // OS notifications so the user gets feedback.
                run_update_check(app.clone(), true);
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // Left-click toggles the window between visible / hidden.
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(w) = app.get_webview_window("main") {
                    let visible = w.is_visible().unwrap_or(false);
                    if visible {
                        let _ = w.hide();
                    } else {
                        let _ = w.show();
                        let _ = w.unminimize();
                        let _ = w.set_focus();
                    }
                }
            }
        })
        .build(app)?;
    eprintln!("[tray] built OK — look for the icon in the Windows notification area (may be hidden in the chevron overflow)");
    Ok(())
}

fn update_tray_tooltip(app: &AppHandle, tooltip: &str) {
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_tooltip(Some(tooltip));
    }
}

// Shared "always-on-top widget mode" toggle. Used by the compact
// refinery card AND the crew salvage live summary, with each
// providing its own hash route + window dimensions. Tracking
// toggle state via is_always_on_top() means clicking either
// menu item exits whichever widget is currently up — switching
// modes works in two clicks (off + on) without any extra state.
fn toggle_widget_mode(app: &AppHandle, hash: &str, width: f64, height: f64) {
    let Some(w) = app.get_webview_window("main") else { return };
    let currently_on_top = w.is_always_on_top().unwrap_or(false);
    if currently_on_top {
        let _ = w.set_always_on_top(false);
        // Restore full-app chrome.
        let _ = w.set_decorations(true);
        let _ = w.set_min_size(Some(tauri::LogicalSize::new(980.0, 640.0)));
        let _ = w.set_size(tauri::LogicalSize::new(1400.0, 900.0));
        let _ = w.eval("if (window.location.hash !== '') { window.location.hash = ''; }");
    } else {
        let _ = w.set_always_on_top(true);
        // Frameless so the widget hovers cleanly on top of Star
        // Citizen without an OS titlebar eating pixels. The React
        // side provides a CSS app-region:drag handle so the user
        // can still move the window around.
        let _ = w.set_decorations(false);
        // Lower the min size for widget mode so the user can shrink it
        // further if they want; resizable stays true (inherited from
        // tauri.conf.json) so they can also grow it to taste, and the
        // React side rescales text proportionally.
        let _ = w.set_min_size(Some(tauri::LogicalSize::new(240.0, 180.0)));
        let _ = w.set_size(tauri::LogicalSize::new(width, height));
        let js = format!(
            "if (window.location.hash !== '{hash}') {{ window.location.hash = '{hash}'; }}"
        );
        let _ = w.eval(&js);
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

// -----------------------------------------------------------------
// Background poll (Phase 2).
// -----------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct LedgerResponse {
    #[serde(default, rename = "refineryJobs")]
    refinery_jobs: Vec<RefineryJob>,
}

#[derive(Debug, Deserialize)]
struct RefineryJob {
    id: String,
    #[serde(default)]
    material: Option<String>,
    #[serde(default)]
    location: Option<String>,
    #[serde(default, rename = "completesAt")]
    completes_at: Option<i64>,
    #[serde(default, rename = "pickedUpAt")]
    picked_up_at: Option<i64>,
    #[serde(default, rename = "deletedAt")]
    deleted_at: Option<i64>,
    #[serde(default, rename = "yield")]
    yield_scu: Option<f64>,
}

fn now_millis() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn format_eta(ms_remaining: i64) -> String {
    if ms_remaining <= 0 {
        return "ready now".into();
    }
    let total_secs = ms_remaining / 1000;
    let h = total_secs / 3600;
    let m = (total_secs % 3600) / 60;
    let s = total_secs % 60;
    if h > 0 {
        format!("{h}h {m:02}m")
    } else if m > 0 {
        format!("{m}m {s:02}s")
    } else {
        format!("{s}s")
    }
}

fn build_tooltip(jobs: &[RefineryJob], now: i64) -> String {
    let active: Vec<&RefineryJob> = jobs
        .iter()
        .filter(|j| j.deleted_at.is_none() && j.picked_up_at.is_none())
        .collect();
    let total = active.len();
    if total == 0 {
        return "SCSalvager · idle".into();
    }
    let ready_count = active
        .iter()
        .filter(|j| j.completes_at.unwrap_or(i64::MAX) <= now)
        .count();
    if ready_count > 0 {
        return format!(
            "SCSalvager · {ready_count} ready · {total} total"
        );
    }
    // Find next pickup.
    let next = active
        .iter()
        .filter_map(|j| j.completes_at.map(|c| (j, c)))
        .min_by_key(|(_, c)| *c);
    match next {
        Some((_, c)) => format!(
            "SCSalvager · next pickup {} · {total} active",
            format_eta(c - now)
        ),
        None => format!("SCSalvager · {total} active"),
    }
}

async fn poll_once(
    client: &reqwest::Client,
    token: &str,
    seen: &Arc<Mutex<HashSet<String>>>,
    app: &AppHandle,
) -> Result<(), String> {
    let url = format!("{SCSALVAGER_ORIGIN}/api/ledger");
    let res = client
        .get(&url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("send: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("status {}", res.status()));
    }
    // Capture the raw response text first so we can mirror it to
    // the on-disk + WebView cache before parsing. Lets the web
    // app fall back to this exact byte-for-byte payload when
    // online fetch fails later.
    let raw = res.text().await.map_err(|e| format!("read body: {e}"))?;
    write_ledger_cache(app, &raw);
    let body: LedgerResponse = serde_json::from_str(&raw).map_err(|e| format!("parse: {e}"))?;
    let now = now_millis();

    // Refresh tray tooltip with fresh state every poll.
    update_tray_tooltip(app, &build_tooltip(&body.refinery_jobs, now));

    // Fire one notification per newly-ready job.
    for job in &body.refinery_jobs {
        if job.deleted_at.is_some() || job.picked_up_at.is_some() {
            continue;
        }
        let Some(c) = job.completes_at else { continue };
        if c > now {
            continue;
        }
        let already_seen = {
            let seen_guard = seen.lock().unwrap();
            seen_guard.contains(&job.id)
        };
        if already_seen {
            continue;
        }
        {
            let mut seen_guard = seen.lock().unwrap();
            seen_guard.insert(job.id.clone());
        }
        let material = job.material.clone().unwrap_or_else(|| "Refinery".into());
        let location = job
            .location
            .clone()
            .unwrap_or_else(|| "unknown".into());
        let scu = job.yield_scu.unwrap_or(0.0);
        let body_text = format!("{material} · {scu:.2} SCU at {location}");
        let n = app
            .notification()
            .builder()
            .title("Refinery Ready")
            .body(&body_text)
            .show();
        if let Err(e) = n {
            eprintln!("[poll] notification failed: {e:?}");
        }
    }
    Ok(())
}

fn spawn_background_poll(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let client = reqwest::Client::builder()
            .user_agent("scsalvager-desktop/0.1")
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        let seen: Arc<Mutex<HashSet<String>>> = Arc::new(Mutex::new(HashSet::new()));
        loop {
            // ensure_session_token covers both auth paths:
            //   1. Deep-link bridge wrote auth.json
            //   2. In-WebView OAuth set the cookie inside Tauri's
            //      cookie jar; we pull it via cookies_for_url and
            //      mirror to auth.json
            // No-op when the user hasn't signed in yet.
            if let Some(token) = ensure_session_token(&app) {
                if let Err(e) = poll_once(&client, &token, &seen, &app).await {
                    // Quiet failures — most likely network blip or session
                    // not yet established. Only log to stderr; tray tooltip
                    // stays at its last good value.
                    eprintln!("[poll] {e}");
                    // 401 means the cached token went stale (server
                    // rotated the session). Clear auth.json so the
                    // next iteration re-pulls a fresh cookie from
                    // the WebView jar.
                    if e.contains("401") {
                        if let Some(path) = auth_file_path(&app) {
                            let _ = std::fs::remove_file(path);
                        }
                    }
                }
            }
            tokio::time::sleep(Duration::from_secs(POLL_INTERVAL_SECS)).await;
        }
    });
}

// -----------------------------------------------------------------
// Phase 3 — Star Citizen window screenshot capture + upload.
// -----------------------------------------------------------------

fn capture_sc_window_png() -> Result<Vec<u8>, String> {
    let windows = xcap::Window::all().map_err(|e| format!("enumerate windows: {e}"))?;
    let target = windows
        .into_iter()
        .find(|w| {
            w.title()
                .map(|t| t.to_lowercase().contains(SC_WINDOW_TITLE_HINT))
                .unwrap_or(false)
        })
        .ok_or_else(|| {
            "Star Citizen window not found. Is the game running and visible?".to_string()
        })?;
    let img = target
        .capture_image()
        .map_err(|e| format!("capture image: {e}"))?;
    let mut buf: Vec<u8> = Vec::new();
    {
        // PNG encode the RGBA buffer xcap returns. image 0.25 takes
        // a writer + RGBA bytes via DynamicImage::ImageRgba8.
        let dynimg = image::DynamicImage::ImageRgba8(img);
        let mut cursor = std::io::Cursor::new(&mut buf);
        dynimg
            .write_to(&mut cursor, image::ImageFormat::Png)
            .map_err(|e| format!("encode png: {e}"))?;
    }
    Ok(buf)
}

/// Capture kind discriminator. Picked by which tray menu item fired
/// the capture; passed through to the React bridge so the server-side
/// analyzer knows which validator (refinery vs commodity terminal)
/// to run against the OCR result.
#[derive(Debug, Clone, Copy)]
enum CaptureKind {
    Refinery,
    Commodity,
}

impl CaptureKind {
    fn title(&self) -> &'static str {
        match self {
            CaptureKind::Refinery => "Refinery Screenshot Failed",
            CaptureKind::Commodity => "Commodity Sale Screenshot Failed",
        }
    }
    fn bridge_fn(&self) -> &'static str {
        match self {
            CaptureKind::Refinery => "openRefineryCrop",
            CaptureKind::Commodity => "openCommodityCrop",
        }
    }
}

fn handle_screenshot_hotkey(app: AppHandle, kind: CaptureKind) {
    eprintln!("[capture] hotkey received ({kind:?}), beginning capture pipeline");
    tauri::async_runtime::spawn(async move {
        // Capture happens off the UI thread. xcap is sync so wrap
        // in spawn_blocking to keep tokio runtime healthy.
        let png = match tauri::async_runtime::spawn_blocking(capture_sc_window_png).await {
            Ok(Ok(b)) => b,
            Ok(Err(e)) => {
                let _ = app
                    .notification()
                    .builder()
                    .title(kind.title())
                    .body(&e)
                    .show();
                return;
            }
            Err(e) => {
                let _ = app
                    .notification()
                    .builder()
                    .title(kind.title())
                    .body(&format!("blocking task: {e}"))
                    .show();
                return;
            }
        };

        // Hand the captured PNG off to the WebView's crop modal.
        // Rust no longer uploads directly — the user gets a chance
        // to drag-select the panel before it ships, which tightens
        // Anthropic API usage + improves OCR accuracy. The bridge
        // method name encodes the capture kind (openRefineryCrop /
        // openCommodityCrop) so the web side routes it to the right
        // analyze endpoint.
        let b64 = base64::engine::general_purpose::STANDARD.encode(&png);
        let Some(window) = app.get_webview_window("main") else {
            let _ = app
                .notification()
                .builder()
                .title(kind.title())
                .body("Main window missing.")
                .show();
            return;
        };
        // Bring the window forward + unminimize FIRST so the crop
        // modal is immediately visible.
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        // If compact-mode is on, exit it so the crop modal has
        // room to render. The web hook listens for hashchange.
        let _ = window.eval(
            "if (window.location.hash === '#compact' || window.location.hash === '#crew-widget') { window.location.hash = ''; }",
        );
        // Hand off to the React bridge. Falls back to a quiet
        // console.warn when the bridge isn't registered (web app
        // still loading, or running an older bundle without the
        // desktop-bridge hook).
        let bridge_fn = kind.bridge_fn();
        let js = format!(
            r#"
            (function () {{
                var b = window.__SCSALVAGER_DESKTOP__;
                if (b && typeof b.{bridge_fn} === 'function') {{
                    b.{bridge_fn}({b64_json}, "image/png");
                }} else {{
                    console.warn("[scsalvager-desktop] {bridge_fn} bridge not registered");
                }}
            }})();
            "#,
            b64_json = serde_json::to_string(&b64).unwrap_or_else(|_| "\"\"".to_string()),
        );
        if let Err(e) = window.eval(&js) {
            eprintln!("[capture] eval failed: {e:?}");
            let _ = app
                .notification()
                .builder()
                .title(kind.title())
                .body(&format!("WebView eval: {e}"))
                .show();
            return;
        }
        let _ = app
            .notification()
            .builder()
            .title("Refinery Screenshot Ready")
            .body("Crop the refinery panel in the SCSalvager window, then click Confirm.")
            .show();
    });
}

// -----------------------------------------------------------------
// Phase 3b — Auto-updater.
// -----------------------------------------------------------------
//
// On startup (after a short grace period so the UI lands first),
// hit /api/desktop/manifest. If a signed update exists, prompt
// the user via OS notification — they keep working uninterrupted
// until they click. Click → download + install + relaunch.
//
// Manifest is signed with the operator's minisign private key;
// the public key embedded in tauri.conf.json verifies. Without a
// real key the updater plugin will refuse every manifest as
// invalid signature, which is fine for dev builds — the check
// just no-ops.

/// Push an update-flow status into the WebView so React can render
/// the proper modal (up-to-date message, Update Now button,
/// download progress, completion, etc). Mirrors the bridge pattern
/// used elsewhere — calls window.__SCSALVAGER_DESKTOP__.onUpdateStatus
/// via webview eval and falls back silently if the bridge isn't
/// registered yet (web bundle still loading).
fn emit_update_status(
    app: &AppHandle,
    status: &str,
    version: Option<&str>,
    message: Option<&str>,
) {
    let Some(window) = app.get_webview_window("main") else { return };
    let payload = serde_json::json!({
        "status": status,
        "version": version,
        "message": message,
        "currentVersion": env!("CARGO_PKG_VERSION"),
    });
    let payload_str = serde_json::to_string(&payload)
        .unwrap_or_else(|_| "{}".to_string());
    let js = format!(
        r#"
        (function () {{
            var b = window.__SCSALVAGER_DESKTOP__;
            if (b && typeof b.onUpdateStatus === 'function') {{
                b.onUpdateStatus({payload_str});
            }}
        }})();
        "#
    );
    let _ = window.eval(&js);
    // Make the window visible if it was minimized to tray, so the
    // user actually sees the update modal after clicking the tray
    // "Check for updates…" item.
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
}

/// Runs the updater check. `manual=true` (tray click) emits status
/// events to the WebView so React surfaces a proper modal with an
/// "Update Now" button — no auto-download. `manual=false` (launch-time
/// path) keeps the legacy auto-download + OS-notification behavior.
fn run_update_check(app: AppHandle, manual: bool) {
    tauri::async_runtime::spawn(async move {
        let updater = match app.updater() {
            Ok(u) => u,
            Err(e) => {
                eprintln!("[updater] init failed: {e}");
                if manual {
                    emit_update_status(
                        &app,
                        "error",
                        None,
                        Some(&format!("Could not init updater: {e}")),
                    );
                }
                return;
            }
        };
        let update = match updater.check().await {
            Ok(u) => u,
            Err(e) => {
                eprintln!("[updater] check failed: {e}");
                if manual {
                    emit_update_status(
                        &app,
                        "error",
                        None,
                        Some(&format!("Could not reach update server: {e}")),
                    );
                }
                return;
            }
        };
        let Some(update) = update else {
            eprintln!("[updater] up to date");
            if manual {
                emit_update_status(&app, "up_to_date", None, None);
            }
            return;
        };
        let new_version = update.version.clone();
        eprintln!("[updater] new version available: {new_version}");

        if manual {
            // Manual flow: don't auto-download. React modal shows
            // the version + an Update Now button; the user clicks
            // it to invoke the apply_update command which does the
            // actual download + restart.
            emit_update_status(&app, "available", Some(&new_version), None);
            return;
        }

        // Launch-time auto-check: original behavior — notify the
        // user via OS toast + download in the background so the
        // update applies on the next quit/reopen.
        let _ = app
            .notification()
            .builder()
            .title("SCSalvager update available")
            .body(&format!(
                "Version {new_version} is downloading. Quit + reopen to apply."
            ))
            .show();

        let mut downloaded: u64 = 0;
        let result = update
            .download_and_install(
                |chunk_len, content_len| {
                    downloaded += chunk_len as u64;
                    if let Some(total) = content_len {
                        eprintln!("[updater] downloaded {downloaded}/{total} bytes");
                    }
                },
                || {
                    eprintln!("[updater] download finished, will apply on next launch");
                },
            )
            .await;
        match result {
            Ok(()) => {
                let _ = app
                    .notification()
                    .builder()
                    .title("SCSalvager update ready")
                    .body(&format!(
                        "Version {new_version} downloaded. Quit + reopen to install."
                    ))
                    .show();
            }
            Err(e) => {
                eprintln!("[updater] download failed: {e}");
                let _ = app
                    .notification()
                    .builder()
                    .title("SCSalvager update failed")
                    .body(&format!("Could not download update: {e}"))
                    .show();
            }
        }
    });
}

fn spawn_update_checker(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        // Grace period so the WebView and tray have time to settle
        // before the updater starts thrashing the network.
        tokio::time::sleep(Duration::from_secs(15)).await;
        run_update_check(app, false);
    });
}

/// Tauri command — invoked from JS via window.__TAURI_INTERNALS__.invoke
/// when the user clicks "Update Now" in the React update modal.
/// Re-runs the updater check (so we hold a fresh Update handle) and
/// downloads + installs it, restarting the app when finished.
/// Progress + completion + failure are pushed back to the WebView
/// via the same emit_update_status bridge.
#[tauri::command]
async fn apply_update(app: AppHandle) -> Result<(), String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    let update = updater
        .check()
        .await
        .map_err(|e| {
            emit_update_status(&app, "error", None, Some(&format!("Check failed: {e}")));
            e.to_string()
        })?;
    let Some(update) = update else {
        emit_update_status(&app, "up_to_date", None, None);
        return Err("No update available".into());
    };
    let new_version = update.version.clone();
    emit_update_status(&app, "downloading", Some(&new_version), None);

    let app_clone = app.clone();
    let mut downloaded: u64 = 0;
    let result = update
        .download_and_install(
            move |chunk_len, content_len| {
                downloaded += chunk_len as u64;
                if let Some(total) = content_len {
                    let pct = ((downloaded as f64 / total as f64) * 100.0).round() as i64;
                    let payload = serde_json::json!({
                        "downloaded": downloaded,
                        "total": total,
                        "percent": pct,
                    });
                    let payload_str = serde_json::to_string(&payload)
                        .unwrap_or_else(|_| "{}".to_string());
                    if let Some(w) = app_clone.get_webview_window("main") {
                        let js = format!(
                            "if(window.__SCSALVAGER_DESKTOP__ && typeof window.__SCSALVAGER_DESKTOP__.onUpdateProgress==='function') {{ window.__SCSALVAGER_DESKTOP__.onUpdateProgress({payload_str}); }}"
                        );
                        let _ = w.eval(&js);
                    }
                }
            },
            || {},
        )
        .await;
    match result {
        Ok(()) => {
            emit_update_status(&app, "ready", Some(&new_version), None);
            // Restart so the new binary takes over immediately.
            app.restart();
        }
        Err(e) => {
            emit_update_status(
                &app,
                "error",
                Some(&new_version),
                Some(&format!("Download failed: {e}")),
            );
            Err(e.to_string())
        }
    }
}

// -----------------------------------------------------------------
// Tauri entry.
// -----------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            for arg in argv.iter().skip(1) {
                if let Some(token) = extract_token_from_deep_link(arg) {
                    handle_token_received(app, token);
                    break;
                }
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![apply_update])
        .on_window_event(|window, event| {
            // Close button minimizes to tray rather than quitting so the
            // background refinery poller keeps running. The tray menu's
            // Quit item is the only way to fully exit.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            // Stamp the running version into the main window title
            // so users can see what build they're on without opening
            // Settings. Resolved at compile time from Cargo.toml's
            // package.version — bumping the crate version is enough
            // to update this on the next release.
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_title(&format!(
                    "SCSalvager Desktop v{}",
                    env!("CARGO_PKG_VERSION")
                ));
            }

            // Tray first so the tooltip helper is ready before the
            // background poller fires its first update.
            if let Err(e) = build_tray(app.handle()) {
                eprintln!("[setup] tray build failed: {e}");
            }

            // Subscribe to subsequent deep-link activations.
            let dl_handle = app.handle().clone();
            use tauri_plugin_deep_link::DeepLinkExt;
            // Production (MSI / NSIS / DMG / .desktop file) registers
            // scsalvager:// at install time via the bundler. Debug
            // builds never run an installer, so the OS doesn't know
            // which executable to dispatch the scheme to. register()
            // writes the scheme into the Windows user registry
            // (HKCU\Software\Classes\scsalvager) on Windows and is a
            // no-op-but-safe on other platforms. Without this, the
            // browser's "Open SCSalvager Desktop" link fails silently.
            #[cfg(desktop)]
            {
                // register_all() pulls schemes from tauri.conf.json's
                // plugins.deep-link.desktop.schemes — covers every
                // scheme listed there in one shot.
                match app.deep_link().register_all() {
                    Ok(()) => eprintln!("[deep-link] register_all OK"),
                    Err(e) => {
                        eprintln!("[deep-link] register_all failed: {e}");
                        // Fallback: try a single explicit register
                        // for the one scheme we actually use.
                        if let Err(e2) = app.deep_link().register("scsalvager") {
                            eprintln!("[deep-link] explicit register failed: {e2}");
                        }
                    }
                }
                // Diagnostic: log the resolved exe path so we can
                // verify the registry entry points where we expect.
                if let Ok(exe) = std::env::current_exe() {
                    eprintln!("[deep-link] dev exe = {exe:?}");
                }
            }
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    if let Some(token) = extract_token_from_deep_link(url.as_str()) {
                        handle_token_received(&dl_handle, token);
                    }
                }
            });

            // Cold-launch deep-link path (Windows + Linux pass the URL
            // via argv on first launch).
            #[cfg(any(windows, target_os = "linux"))]
            {
                let args: Vec<String> = std::env::args().collect();
                let cold_handle = app.handle().clone();
                for arg in args.iter().skip(1) {
                    if let Some(token) = extract_token_from_deep_link(arg) {
                        handle_token_received(&cold_handle, token);
                        break;
                    }
                }
            }

            // Seed the WebView with any cached ledger payload from
            // a previous session so the offline fallback is
            // available before the first poll completes.
            seed_ledger_cache_into_webview(app.handle());

            // Kick off the background poll loop. Sleeps 30 s between
            // iterations; no-op when no session token on disk.
            spawn_background_poll(app.handle().clone());

            // Check for app updates after a short grace period.
            // No-op if the manifest endpoint returns nothing, the
            // signature doesn't verify, or we're already on the
            // newest version.
            spawn_update_checker(app.handle().clone());

            // Register the refinery-screenshot global hotkey
            // (F9) WITH its handler in a single on_shortcut call.
            // The earlier with_handler + register split appeared
            // to register the shortcut without actually wiring
            // the OS hook on Windows — keypresses didn't reach
            // the handler. on_shortcut binds them atomically.
            let capture_shortcut = Shortcut::new(None, Code::F9);
            let cap_handle = app.handle().clone();
            match app.global_shortcut().on_shortcut(
                capture_shortcut,
                move |_app, _shortcut, event| {
                    eprintln!("[hotkey] F9 event state={:?}", event.state());
                    if event.state() == ShortcutState::Pressed {
                        // F9 defaults to refinery; commodity captures
                        // go through the tray menu's dedicated item.
                        handle_screenshot_hotkey(cap_handle.clone(), CaptureKind::Refinery);
                    }
                },
            ) {
                Ok(()) => eprintln!("[hotkey] F9 → SC screenshot capture"),
                Err(e) => eprintln!("[hotkey] register failed: {e}"),
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running SCSalvager Desktop");
}
