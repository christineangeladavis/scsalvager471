// POST /api/notifications/test
// Sends a test DM to the logged-in user via the Discord bot.
// Requires (a) an active session, (b) the user has linked notifications.
// Returns { ok: true } on success or { ok: false, error } on failure.

import { getRedis } from "../_lib/redis.js";
import { getSession } from "../_lib/session.js";
import { getPrefs } from "../_lib/prefs.js";
import { sendDirectMessage, explainDmFailure } from "../_lib/discordBot.js";

const TEST_MESSAGE =
  "Test DM from SC Salvager. Notifications are working — when your refinery jobs complete, you'll get a DM here.";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  let redis;
  try {
    redis = getRedis();
  } catch (e) {
    return res.status(503).json({ error: e.message });
  }

  const session = await getSession(req, redis);
  if (!session) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  res.setHeader("cache-control", "private, no-store");

  const prefs = await getPrefs(redis, session.userId);
  if (!prefs.notificationLinkedAt) {
    return res
      .status(400)
      .json({ ok: false, error: "Discord notifications aren't connected yet. Click 'Connect Discord' first." });
  }

  const result = await sendDirectMessage(session.userId, TEST_MESSAGE);
  if (result.ok) {
    return res.status(200).json({ ok: true });
  }

  const friendly = explainDmFailure(result);
  console.warn(
    "Test DM failed:",
    JSON.stringify({ userId: session.userId, status: result.status, code: result.code, message: result.message })
  );
  return res.status(200).json({
    ok: false,
    error: friendly || result.message || "Could not send DM.",
    status: result.status,
    code: result.code,
  });
}
