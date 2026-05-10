// SCSalvager Desktop — Tauri 2 application setup.
//
// Phase 1 responsibilities (this file):
//   1. Register the scsalvager:// custom URI scheme via
//      tauri-plugin-deep-link so /api/auth/desktop-callback can
//      hand us a session token.
//   2. Use tauri-plugin-single-instance so subsequent deep-link
//      activations route into the running window instead of
//      spawning a duplicate process.
//   3. On deep-link receipt: parse `token=` out of the URL and
//      inject it into the WebView as a SESSION cookie on the
//      scsalvager.net domain so subsequent in-WebView navigation
//      is authenticated.
//
// Phase 2 will add tray, hotkeys, notifications, and the
// background poller behind feature flags. Keeping that scaffolding
// commented out below so the diff is small when we get there.

use tauri::Manager;
use tauri_plugin_deep_link::DeepLinkExt;
use url::Url;

const SESSION_COOKIE: &str = "scs_session";
const SCSALVAGER_ORIGIN: &str = "https://scsalvager.net";

fn extract_token_from_deep_link(raw: &str) -> Option<String> {
    let parsed = Url::parse(raw).ok()?;
    if parsed.scheme() != "scsalvager" {
        return None;
    }
    // Tolerate any host (auth, settings, etc.) — only the `token`
    // query parameter matters for the OAuth handoff.
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

fn handle_token_received(app: &tauri::AppHandle, token: String) {
    // Inject SESSION cookie into the main window's WebView, then
    // navigate to the site root so the React app picks up the
    // freshly-authenticated session on its next /api/auth/me poll.
    let Some(window) = app.get_webview_window("main") else {
        eprintln!("[deep-link] main window missing on token receipt");
        return;
    };
    // Best-effort cookie injection via document.cookie. The site
    // sets the same cookie HTTP-only on the web flow; we can't
    // mirror HttpOnly from the WebView side, but the SameSite=Lax,
    // Secure cookie still authenticates server requests for the
    // current process. Phase 2 swaps this for a proper Set-Cookie
    // via Tauri's cookie store API once the relevant Tauri 2 API
    // surface stabilizes.
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // Second-instance launch (e.g. another deep-link click).
            // argv[1..] usually contains the deep-link URL on
            // Windows / Linux; macOS routes through the deep-link
            // plugin's event channel directly.
            for arg in argv.iter().skip(1) {
                if let Some(token) = extract_token_from_deep_link(arg) {
                    handle_token_received(app, token);
                    break;
                }
            }
            // Bring the existing window forward.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .setup(|app| {
            // Subscribe to subsequent deep-link activations.
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    if let Some(token) = extract_token_from_deep_link(url.as_str()) {
                        handle_token_received(&handle, token);
                    }
                }
            });
            // Handle a deep link that started the process (cold
            // launch — argv hasn't been seen by the single-instance
            // plugin yet).
            #[cfg(any(windows, target_os = "linux"))]
            {
                let args: Vec<String> = std::env::args().collect();
                let handle = app.handle().clone();
                for arg in args.iter().skip(1) {
                    if let Some(token) = extract_token_from_deep_link(arg) {
                        handle_token_received(&handle, token);
                        break;
                    }
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running SCSalvager Desktop");
}
