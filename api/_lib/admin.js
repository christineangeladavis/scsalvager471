// Centralized admin gate. Used by every /api/admin/* endpoint and by
// the isAdmin flag on /api/auth/me.
//
// Resolution order:
//   1. process.env.ADMIN_DISCORD_ID — primary; settable in the Vercel
//      project env vars. Comma-separated list of IDs is supported.
//   2. FALLBACK_ADMIN_IDS — hardcoded site-owner IDs, used when the env
//      var is missing or empty. Lets the owner stay locked-in even if
//      the Vercel env var gets cleared / misspelled.
//
// Discord user IDs are public snowflake numbers (visible to anyone in
// a shared server), not credentials. Treat them as identifiers, not
// secrets.

const FALLBACK_ADMIN_IDS = [
  // ChrissyNightingale (site owner)
  "125372743637008384",
  // Junior2065
  "237446168206901259",
];

/**
 * Returns the parsed list of admin Discord user IDs from env, or the
 * fallback list if the env var is unset/empty.
 */
export function adminIdList() {
  const raw = (process.env.ADMIN_DISCORD_ID || "").trim();
  if (raw) {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return FALLBACK_ADMIN_IDS.slice();
}

/**
 * Returns true if the supplied session is an admin session.
 * Returns false for null/undefined sessions.
 */
export function isAdminSession(session) {
  if (!session || !session.userId) return false;
  const ids = adminIdList();
  return ids.includes(String(session.userId));
}
