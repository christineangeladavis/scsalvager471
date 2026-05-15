// POST /api/me/credit-crew-session
//
// Self-service: when a captain marks a Crew Salvage session complete on
// their own ledger, this endpoint copies the per-pilot split share into
// each registered pilot's ledger. Pilots who aren't registered on the
// site are silently skipped.
//
// Recipients identified by case-insensitive match on their mirrored
// Discord display name (`user:<id>.username`). Custom display names
// are not consulted yet — pilots whose roster entry uses a custom name
// won't auto-credit until the matching logic grows a customName index.
//
// Body shape:
//   {
//     sessionId,           // string — for audit traces only
//     ship,                // string — used in the synthetic location
//     totalHulls,          // number — appended to the location label
//     completedAt,         // ms — used as submittedAt on each entry
//     pilots: [            // one entry per crew slot the captain wants
//       { name, scu, aUEC }//   to fan-out. Captain's own roster entry
//     ]                    //   is dropped client-side before POST.
//   }
//
// For each pilot whose name resolves to a known userId:
//   - Append a Crew Salvage sell-order entry to that recipient's ledger
//   - Skip if it would be the caller themselves (no double-credit)
//   - Skip if scu <= 0 AND aUEC <= 0 (nothing to log)
//
// Response:
//   200 { ok: true, credited: [{ pilot, userId }], skipped: [{ pilot, reason }] }
//   400 { error: "..." }
//   401 { error: "Not authenticated" }
//   503 { error: "Storage unavailable" }
//
// Security notes:
//   - Endpoint can only write Crew Salvage entries with positive deltas.
//   - Spam protection is left to the recipient — Crew Salvage rows are
//     individually deletable from the recipient's Patch History. A
//     future tightening could require recipients to opt-in via prefs;
//     for now the captain bears the social cost of bogus splits.

import { getRedis } from "../_lib/redis.js";
import { getSession } from "../_lib/session.js";
import { ledgerKey, sanitizeSellOrder } from "../ledger.js";
import { listUserIds, getUserMeta } from "../_lib/userIndex.js";

const MAX_PILOTS = 20;

async function buildUsernameIndex(redis) {
  // Walk every indexed userId and build a case-insensitive
  // username -> userId map. Acceptable for the current scale
  // (hundreds of users); revisit if the site grows past ~5k
  // registered users.
  const ids = await listUserIds(redis);
  const byName = new Map();
  for (const id of ids) {
    try {
      const meta = await getUserMeta(redis, id);
      if (!meta || !meta.username) continue;
      byName.set(meta.username.trim().toLowerCase(), id);
    } catch {
      // ignore per-user lookup failures; keep building the map
    }
  }
  return byName;
}

async function appendCrewEntry(redis, userId, entry) {
  const key = ledgerKey(userId);
  let data;
  try {
    data = (await redis.get(key)) || { refineryJobs: [], sellOrders: [], crewSessions: [] };
  } catch (e) {
    console.error(
      "credit-crew-session: ledger read failed:",
      e && e.message ? e.message : e
    );
    return false;
  }
  const cleaned = sanitizeSellOrder(entry);
  if (!cleaned) return false;
  const refineryJobs = Array.isArray(data.refineryJobs) ? data.refineryJobs : [];
  const sellOrders = Array.isArray(data.sellOrders) ? data.sellOrders : [];
  const crewSessions = Array.isArray(data.crewSessions) ? data.crewSessions : [];
  sellOrders.push(cleaned);
  try {
    await redis.set(key, { refineryJobs, sellOrders, crewSessions });
  } catch (e) {
    console.error(
      "credit-crew-session: ledger write failed:",
      e && e.message ? e.message : e
    );
    return false;
  }
  return true;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  res.setHeader("cache-control", "private, no-store");

  let redis;
  try {
    redis = getRedis();
  } catch {
    return res.status(503).json({ error: "Storage unavailable" });
  }

  const session = await getSession(req, redis);
  if (!session) return res.status(401).json({ error: "Not authenticated" });
  const callerId = String(session.userId || "");
  if (!callerId) return res.status(401).json({ error: "Not authenticated" });

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  if (!body || typeof body !== "object") {
    return res.status(400).json({ error: "Invalid JSON" });
  }

  const sessionId = typeof body.sessionId === "string" ? body.sessionId.slice(0, 80) : "";
  const ship = typeof body.ship === "string" ? body.ship.slice(0, 80) : "";
  const totalHulls = Number.isFinite(Number(body.totalHulls)) ? Number(body.totalHulls) : 0;
  const completedAt = Number.isFinite(Number(body.completedAt)) ? Number(body.completedAt) : Date.now();
  const pilots = Array.isArray(body.pilots) ? body.pilots.slice(0, MAX_PILOTS) : [];
  if (pilots.length === 0) {
    return res.status(200).json({ ok: true, credited: [], skipped: [] });
  }

  const usernameIndex = await buildUsernameIndex(redis);

  const credited = [];
  const skipped = [];
  for (const p of pilots) {
    if (!p || typeof p !== "object") continue;
    const rawName = typeof p.name === "string" ? p.name.trim() : "";
    if (!rawName) {
      skipped.push({ pilot: "", reason: "missing name" });
      continue;
    }
    const scu = Number(p.scu) || 0;
    const aUEC = Number(p.aUEC) || 0;
    if (scu <= 0 && aUEC <= 0) {
      skipped.push({ pilot: rawName, reason: "no share" });
      continue;
    }
    const userId = usernameIndex.get(rawName.toLowerCase());
    if (!userId) {
      skipped.push({ pilot: rawName, reason: "not registered" });
      continue;
    }
    if (userId === callerId) {
      skipped.push({ pilot: rawName, reason: "is caller" });
      continue;
    }
    const entry = {
      id: `crew-salvage-credit-${completedAt}-${Math.floor(Math.random() * 1e6)}`,
      material: "Crew Salvage",
      scu,
      location: `Crew Salvage · ${ship}${totalHulls > 0 ? ` · ${totalHulls} hull${totalHulls === 1 ? "" : "s"}` : ""}`,
      playerName: "",
      aUEC,
      submittedAt: completedAt,
      deletedAt: null,
      dismissedFromRecentAt: null,
    };
    const ok = await appendCrewEntry(redis, userId, entry);
    if (ok) {
      credited.push({ pilot: rawName, userId });
    } else {
      skipped.push({ pilot: rawName, reason: "ledger write failed" });
    }
  }

  return res.status(200).json({ ok: true, credited, skipped, sessionId });
}
