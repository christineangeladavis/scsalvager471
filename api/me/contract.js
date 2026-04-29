// POST /api/me/contract
//
// Mission-contract lifecycle for the calling user. Multiple
// concurrent contracts are allowed; the per-user array lives at
// prefs.activeContracts. Three actions:
//
//   { action: "accept", missionId, name, reward, buyIn }
//     Add the mission to the user's active list. Refused if the same
//     missionId is already in the list (one active copy per mission).
//     Returns the updated list.
//
//   { action: "complete", missionId, confirm: "COMPLETE_CONTRACT" }
//     Apply both the positive reward AND the negative buy-in for the
//     named contract to the user's ledger, then drop it from
//     activeContracts. Stats / Patch History pick up the entries
//     automatically because they live in the same sellOrders array.
//
//   { action: "abandon", missionId, confirm: "ABANDON_CONTRACT" }
//     Apply ONLY the negative buy-in for the named contract (forfeit
//     the positive reward), then drop it from activeContracts.
//
// Ledger entries written for complete/abandon use:
//   material: "Mission Reward" (positive) | "Mission Buy-In" (negative)
//   location: "Mission: <name>"
//   scu: 0
//   aUEC: signed (positive for reward, negative for buy-in)
//   submittedAt: now
//
// Response:
//   200 { ok: true, currentContract, ledgerCounts? }
//   400 { error: "..." }
//   401 { error: "Not authenticated" }
//   409 { error: "Already have an active contract" }
//   503 { error: "Storage unavailable" }

import { getRedis } from "../_lib/redis.js";
import { getSession } from "../_lib/session.js";
import { getPrefs, updatePrefs } from "../_lib/prefs.js";
import { ledgerKey, sanitizeSellOrder } from "../ledger.js";

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

async function appendLedgerEntry(redis, userId, sellOrder) {
  const key = ledgerKey(userId);
  let data;
  try {
    data = (await redis.get(key)) || { refineryJobs: [], sellOrders: [] };
  } catch (e) {
    console.error("contract: ledger read failed:", e && e.message);
    return false;
  }
  const cleaned = sanitizeSellOrder(sellOrder);
  if (!cleaned) return false;
  const refineryJobs = Array.isArray(data.refineryJobs) ? data.refineryJobs : [];
  const sellOrders = Array.isArray(data.sellOrders) ? data.sellOrders : [];
  sellOrders.push(cleaned);
  try {
    await redis.set(key, { refineryJobs, sellOrders });
  } catch (e) {
    console.error("contract: ledger write failed:", e && e.message);
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
  const userId = String(session.userId || "");
  if (!userId) return res.status(401).json({ error: "Not authenticated" });

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  if (!body || typeof body !== "object") {
    return res.status(400).json({ error: "Invalid JSON" });
  }

  const action = body.action;
  const prefs = await getPrefs(redis, userId);
  const list = Array.isArray(prefs.activeContracts) ? prefs.activeContracts.slice() : [];

  if (action === "accept") {
    const missionId = String(body.missionId || "").slice(0, 80);
    const name = String(body.name || "").slice(0, 240);
    const reward = Number(body.reward);
    const buyIn = Number(body.buyIn);
    if (!missionId || !name) {
      return res.status(400).json({ error: "missionId + name required" });
    }
    if (list.some((c) => c && c.missionId === missionId)) {
      return res.status(409).json({ error: "Contract already active for this mission" });
    }
    const contract = {
      missionId,
      name,
      reward: Number.isFinite(reward) ? reward : 0,
      buyIn: Number.isFinite(buyIn) ? buyIn : 0,
      acceptedAt: Date.now(),
    };
    list.push(contract);
    const next = await updatePrefs(redis, userId, {
      activeContracts: list,
      currentContract: null, // legacy slot — drop now that we've migrated
    });
    return res.status(200).json({ ok: true, activeContracts: next.activeContracts });
  }

  const findContract = (mid) => list.find((c) => c && c.missionId === mid) || null;
  const removeContract = (mid) => list.filter((c) => !c || c.missionId !== mid);

  if (action === "complete" || action === "abandon") {
    const expectedConfirm = action === "complete" ? "COMPLETE_CONTRACT" : "ABANDON_CONTRACT";
    if (body.confirm !== expectedConfirm) {
      return res.status(400).json({ error: "Missing or invalid confirmation" });
    }
    const missionId = String(body.missionId || "").slice(0, 80);
    if (!missionId) return res.status(400).json({ error: "missionId required" });
    const target = findContract(missionId);
    if (!target) return res.status(400).json({ error: "No matching active contract" });

    const now = Date.now();
    let rewardWritten = 0;
    let buyInWritten = 0;

    if (action === "complete") {
      if (Number.isFinite(Number(target.reward)) && Number(target.reward) !== 0) {
        const ok = await appendLedgerEntry(redis, userId, {
          id: makeId("mission-reward"),
          material: "Mission Reward",
          scu: 0,
          location: `Mission: ${target.name}`,
          aUEC: Number(target.reward),
          submittedAt: now,
        });
        if (ok) rewardWritten = Number(target.reward);
      }
    }
    if (Number.isFinite(Number(target.buyIn)) && Number(target.buyIn) > 0) {
      const suffix = action === "abandon" ? " (abandoned)" : "";
      const ok = await appendLedgerEntry(redis, userId, {
        id: makeId("mission-buyin"),
        material: "Mission Buy-In",
        scu: 0,
        location: `Mission: ${target.name}${suffix}`,
        aUEC: -Math.abs(Number(target.buyIn)),
        submittedAt: now,
      });
      if (ok) buyInWritten = -Math.abs(Number(target.buyIn));
    }

    const next = await updatePrefs(redis, userId, {
      activeContracts: removeContract(missionId),
      currentContract: null,
    });
    return res.status(200).json({
      ok: true,
      activeContracts: next.activeContracts,
      applied: { rewardAuec: rewardWritten, buyInAuec: buyInWritten },
    });
  }

  return res.status(400).json({ error: "Unknown action" });
}
