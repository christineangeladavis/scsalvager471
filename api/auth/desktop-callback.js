// GET /api/auth/desktop-callback
//
// Bridge endpoint for the SCSalvager Desktop app's OAuth flow.
//
// Flow:
//   1. Desktop app opens system browser → /api/auth/desktop-callback
//   2. If no session cookie present → 302 to
//      /api/auth/login?return=desktop-callback. The login handler
//      drops a `scs_return_to=desktop-callback` cookie alongside
//      the OAuth state cookie. After Discord OAuth completes,
//      callback.js reads that cookie and bounces back here.
//   3. With session cookie present → render an HTML page that
//      JavaScript-redirects the browser to a `scsalvager://auth?
//      token=<sessionToken>` deep link. The Tauri app catches the
//      deep link, stores the token in the OS keychain, and
//      preloads it as a session cookie inside its WebView.
//
// The token returned via deep link is the SAME opaque session id
// as the cookie — Bearer fallback in api/_lib/session.js accepts
// it for non-WebView API calls (e.g. the Rust background poll).
//
// HTML page also surfaces a "Click here if the app didn't open
// automatically" link so the user has a manual fallback if the
// browser blocks the auto-redirect.

import { parseCookies, SESSION_COOKIE } from "../_lib/session.js";

export default async function handler(req, res) {
  const cookies = parseCookies(req.headers.cookie || "");
  const sessionToken = cookies[SESSION_COOKIE];

  if (!sessionToken) {
    res.writeHead(302, {
      Location: "/api/auth/login?return=desktop-callback",
    });
    res.end();
    return;
  }

  // Encode the token for the deep link URL. URL-safe base64
  // would be cleaner but the token is already URL-safe hex from
  // generateToken() in _lib/session.js. Pass through directly.
  const deepLink = `scsalvager://auth?token=${encodeURIComponent(sessionToken)}`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("cache-control", "private, no-store");
  res.status(200).send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Returning to SCSalvager Desktop…</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="referrer" content="no-referrer" />
    <style>
      body {
        margin: 0;
        background: #0f172a;
        color: #e2e8f0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 100vh;
        padding: 1.5rem;
      }
      .card {
        max-width: 28rem;
        background: #1e293b;
        border: 1px solid rgba(34, 211, 238, 0.25);
        border-radius: 1rem;
        padding: 2rem;
        text-align: center;
        box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
      }
      h1 { color: #67e8f9; font-size: 1.25rem; margin: 0 0 0.5rem; }
      p { color: #94a3b8; line-height: 1.5; margin: 0.75rem 0; font-size: 0.9rem; }
      a.deep {
        display: inline-block;
        margin-top: 1rem;
        padding: 0.6rem 1.2rem;
        background: rgba(34, 211, 238, 0.2);
        border: 1px solid #22d3ee;
        border-radius: 0.75rem;
        color: #67e8f9;
        text-decoration: none;
        font-weight: 600;
      }
      a.deep:hover { background: rgba(34, 211, 238, 0.3); }
      a.web {
        display: inline-block;
        margin-top: 0.5rem;
        color: #94a3b8;
        font-size: 0.8rem;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Returning you to SCSalvager Desktop…</h1>
      <p>If the desktop app didn't open automatically, click the button below.</p>
      <a class="deep" href="${deepLink}">Open SCSalvager Desktop</a>
      <br />
      <a class="web" href="/">Or continue in the browser</a>
    </div>
    <script>
      // Trigger the deep link as soon as the page loads. Browsers
      // need an actual navigation to fire the protocol handler.
      window.location.href = ${JSON.stringify(deepLink)};
    </script>
  </body>
</html>`);
}
