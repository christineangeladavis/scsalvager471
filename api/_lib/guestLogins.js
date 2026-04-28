// Tracks anonymous (non-signed-in) visits so admins can see traffic that
// never made it through the Discord OAuth flow.
//
// Storage:
//   List "guests:logins" — newest first (LPUSH). Each entry is a JSON
//   string of { ts, ua, country }. We trim to MAX_RETAINED on every
//   write so the list never grows unbounded.
//
// IP is deliberately not collected — admins only need a sense of traffic
// volume + browser/region, not a list of source addresses.
//
// Why a list instead of a sorted set: we never query by score range here
// (admin view always wants "the most recent N"), and lpush + ltrim is the
// cheapest pair of ops to keep the working set bounded.

export const GUESTS_LOGINS_KEY = "guests:logins";

// 1000 entries × ~200 bytes ≈ 200KB. Enough recent history for the admin
// view without bloating Redis. Older entries are dropped on the next write.
const MAX_RETAINED = 1000;

/**
 * Append a guest-visit record. Best-effort — failures are logged but
 * never surface to the visitor.
 */
export async function recordGuestLogin(redis, { userAgent, country } = {}) {
  if (!redis) return;
  const ts = Date.now();
  const entry = {
    ts,
    ua: typeof userAgent === "string" ? userAgent.slice(0, 240) : "",
    country: typeof country === "string" ? country.slice(0, 8) : "",
  };
  try {
    await redis.lpush(GUESTS_LOGINS_KEY, JSON.stringify(entry));
    await redis.ltrim(GUESTS_LOGINS_KEY, 0, MAX_RETAINED - 1);
  } catch (e) {
    console.error(
      "recordGuestLogin failed:",
      e && e.message ? e.message : e
    );
  }
}

/**
 * Returns the most recent guest visits, newest first. `limit` is clamped
 * to [1, MAX_RETAINED]. Each entry: { ts, ua, country }.
 */
export async function listRecentGuestLogins(redis, { limit = 200 } = {}) {
  if (!redis) return [];
  const n = Math.max(1, Math.min(MAX_RETAINED, Number(limit) || 0));
  try {
    const raw = await redis.lrange(GUESTS_LOGINS_KEY, 0, n - 1);
    if (!Array.isArray(raw)) return [];
    return raw
      .map((row) => {
        if (typeof row === "string") {
          try {
            return JSON.parse(row);
          } catch {
            return null;
          }
        }
        // Upstash sometimes auto-parses JSON values — pass through.
        return row && typeof row === "object" ? row : null;
      })
      .filter((e) => e && Number.isFinite(Number(e.ts)))
      .map((e) => ({
        ts: Number(e.ts),
        ua: typeof e.ua === "string" ? e.ua : "",
        country: typeof e.country === "string" ? e.country : "",
      }));
  } catch (e) {
    console.error(
      "listRecentGuestLogins failed:",
      e && e.message ? e.message : e
    );
    return [];
  }
}
