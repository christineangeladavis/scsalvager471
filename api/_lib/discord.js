// Discord OAuth 2.0 helpers — only the `identify` scope is requested, which
// returns id, username, discriminator, and avatar hash. No email.

const DISCORD_API = "https://discord.com/api";

export function getDiscordCredentials() {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Discord OAuth is not configured. Set DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET in your Vercel project's Environment Variables, then redeploy."
    );
  }
  return { clientId, clientSecret };
}

export function buildAuthorizeUrl({
  clientId,
  redirectUri,
  state,
  scope = "identify",
  extra = {},
  prompt = "none",
}) {
  const url = new URL(`${DISCORD_API}/oauth2/authorize`);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scope);
  url.searchParams.set("state", state);
  if (prompt) url.searchParams.set("prompt", prompt);
  for (const [k, v] of Object.entries(extra)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  return url.toString();
}

export async function exchangeCodeForToken({ clientId, clientSecret, code, redirectUri }) {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });

  const res = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Discord token exchange failed (${res.status}): ${detail.slice(0, 200)}`);
  }
  return await res.json();
}

export async function fetchDiscordUser(accessToken) {
  const res = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Discord user fetch failed (${res.status}): ${detail.slice(0, 200)}`);
  }
  return await res.json();
}

// Canonical production host. The Discord OAuth app's redirect URI
// allowlist is registered against this exact origin, so we pin it as
// the default whenever we're running on Vercel production. Without the
// pin, requests served via www.scsalvager.net or a *.vercel.app preview
// URL would build a redirect_uri that Discord doesn't recognize and the
// QR-code / web login bounces with "Invalid OAuth2 redirect_uri".
const CANONICAL_PRODUCTION_ORIGIN = "https://scsalvager.net";

export function getOrigin(req) {
  // 1. Explicit override always wins (used in tests + previews).
  if (process.env.SITE_URL) return process.env.SITE_URL;
  // 2. In production, force the canonical origin regardless of which
  //    host fronted the request. Single source of truth for OAuth.
  if (process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production") {
    return CANONICAL_PRODUCTION_ORIGIN;
  }
  // 3. Dev / preview: fall back to whatever host the request came in
  //    on so localhost / preview deploys still work without extra env.
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const proto = req.headers["x-forwarded-proto"] || (host && host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export function getCallbackUri(req, path = "/api/auth/callback") {
  return `${getOrigin(req)}${path}`;
}
