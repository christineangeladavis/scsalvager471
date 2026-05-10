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

use serde::Deserialize;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};
use tauri_plugin_notification::NotificationExt;
use url::Url;

const SESSION_COOKIE: &str = "scs_session";
const SCSALVAGER_ORIGIN: &str = "https://scsalvager.net";
const POLL_INTERVAL_SECS: u64 = 30;
const AUTH_FILE_NAME: &str = "auth.json";

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
    let show = MenuItem::with_id(app, "show", "Show window", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide", "Hide window", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &hide, &sep, &quit])?;

    let icon: Image<'_> = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| tauri::Error::AssetNotFound("default window icon".into()))?;

    TrayIconBuilder::with_id("main")
        .icon(icon)
        .tooltip("SCSalvager · idle")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
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
    Ok(())
}

fn update_tray_tooltip(app: &AppHandle, tooltip: &str) {
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_tooltip(Some(tooltip));
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
    let body: LedgerResponse = res.json().await.map_err(|e| format!("parse: {e}"))?;
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

            // Kick off the background poll loop. Sleeps 30 s between
            // iterations; no-op when no session token on disk.
            spawn_background_poll(app.handle().clone());

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running SCSalvager Desktop");
}
