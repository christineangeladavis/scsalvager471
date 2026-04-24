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

export function buildAuthorizeUrl({ clientId, redirectUri, state }) {
  const url = new URL(`${DISCORD_API}/oauth2/authorize`);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "identify");
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "none");
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

export function getCallbackUri(req) {
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const proto = req.headers["x-forwarded-proto"] || (host && host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}/api/auth/callback`;
}
