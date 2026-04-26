// GET /api/auth/me
// Returns { user: { id, username, avatar } } if logged in, { user: null } otherwise.
// Never errors publicly — a Redis outage just shows the client as logged out.

import { getRedis } from "../_lib/redis.js";
import { getSession } from "../_lib/session.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  res.setHeader("cache-control", "private, no-store");

  try {
    const redis = getRedis();
    const session = await getSession(req, redis);
    if (!session) {
      return res.status(200).json({ user: null });
    }
    const adminId = process.env.ADMIN_DISCORD_ID || "";
    return res.status(200).json({
      user: {
        id: session.userId,
        username: session.discordUsername,
        avatar: session.discordAvatar,
        isAdmin: Boolean(adminId) && String(session.userId) === String(adminId),
      },
    });
  } catch (e) {
    console.error("/api/auth/me error:", e && e.message ? e.message : e);
    return res.status(200).json({ user: null });
  }
}
