// Bot-token Discord client for sending DMs to users who have user-installed
// the app (i.e. authorized `applications.commands` with integration_type=1).
//
// The flow is two-step:
//   1) POST /users/@me/channels with { recipient_id } → returns DM channel object
//   2) POST /channels/{channel.id}/messages with { content } → sends the DM
//
// All errors are normalized into a returned object instead of thrown so callers
// can decide whether a failure is recoverable (e.g. user has DMs disabled).

const DISCORD_API = "https://discord.com/api/v10";

export function getBotToken() {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    throw new Error(
      "Discord bot is not configured. Set DISCORD_BOT_TOKEN in your Vercel project's Environment Variables, then redeploy."
    );
  }
  return token;
}

function botHeaders(token) {
  return {
    Authorization: `Bot ${token}`,
    "Content-Type": "application/json",
    "User-Agent": "scsalvager (https://github.com, 1.0)",
  };
}

/**
 * Open (or fetch) the DM channel between the bot and a Discord user.
 * Returns { ok: true, channelId } on success.
 * Returns { ok: false, status, code, message } on failure.
 */
export async function openDmChannel(userId, { token } = {}) {
  const botToken = token || getBotToken();
  try {
    const res = await fetch(`${DISCORD_API}/users/@me/channels`, {
      method: "POST",
      headers: botHeaders(botToken),
      body: JSON.stringify({ recipient_id: String(userId) }),
    });
    if (!res.ok) {
      const detail = await safeJson(res);
      return {
        ok: false,
        status: res.status,
        code: detail && detail.code,
        message: (detail && detail.message) || `HTTP ${res.status}`,
      };
    }
    const data = await res.json();
    return { ok: true, channelId: data.id };
  } catch (e) {
    return { ok: false, status: 0, message: e && e.message ? e.message : "Network error" };
  }
}

/**
 * Send a message to an already-known channel ID.
 * Returns { ok: true, messageId } on success.
 * Returns { ok: false, status, code, message } on failure.
 */
export async function sendChannelMessage(channelId, content, { token } = {}) {
  const botToken = token || getBotToken();
  try {
    const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
      method: "POST",
      headers: botHeaders(botToken),
      body: JSON.stringify({ content: String(content).slice(0, 2000) }),
    });
    if (!res.ok) {
      const detail = await safeJson(res);
      return {
        ok: false,
        status: res.status,
        code: detail && detail.code,
        message: (detail && detail.message) || `HTTP ${res.status}`,
      };
    }
    const data = await res.json();
    return { ok: true, messageId: data.id };
  } catch (e) {
    return { ok: false, status: 0, message: e && e.message ? e.message : "Network error" };
  }
}

/**
 * Convenience: open a DM and send a message in one call.
 * Returns { ok: true, channelId, messageId } or { ok: false, ... }.
 */
export async function sendDirectMessage(userId, content, opts = {}) {
  const open = await openDmChannel(userId, opts);
  if (!open.ok) return open;
  const send = await sendChannelMessage(open.channelId, content, opts);
  if (!send.ok) return { ...send, channelId: open.channelId };
  return { ok: true, channelId: open.channelId, messageId: send.messageId };
}

/**
 * Map a Discord error response to a short, user-friendly explanation.
 * Returns null if the failure isn't one we have a specific message for.
 */
export function explainDmFailure(failure) {
  if (!failure || failure.ok) return null;
  // 50007: "Cannot send messages to this user" — typically user has DMs
  // disabled in privacy settings or hasn't user-installed the app.
  if (failure.code === 50007) {
    return "Discord won't let us DM you. Either your privacy settings block DMs from apps, or you haven't installed our app to your account.";
  }
  if (failure.status === 403) {
    return "Discord rejected the message (forbidden). Check that you've installed the app to your account.";
  }
  if (failure.status === 401) {
    return "The bot token is invalid or missing. The site owner needs to check the deployment configuration.";
  }
  if (failure.status === 429) {
    return "Discord is rate-limiting us. Try again in a moment.";
  }
  return null;
}

async function safeJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}
