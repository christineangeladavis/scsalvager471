// GET /api/admin/export?type=refineries&patch=4.7.2
// GET /api/admin/export?type=logins&patch=4.7.2
//
// Admin-only. Streams a CSV of either every refinery job submitted in a
// patch's [from, to) cycle, or every login event recorded during that
// cycle. Patch metadata lives in api/_lib/patches.js.
//
// Refinery export columns:
//   username, userId, jobId, material, materialScu, location, method,
//   yieldScu, costAuec, submittedAt, completesAt, pickedUpAt,
//   notificationStatus
//
// Logins export columns:
//   username, userId, loggedInAt
//
// Returns 400 if patch is unknown or has no startedAt yet.

import { getRedis } from "../_lib/redis.js";
import { getSession } from "../_lib/session.js";
import {
  listUserIds,
  getUserMeta,
  listLoginsInRange,
} from "../_lib/userIndex.js";
import { ledgerKey } from "../ledger.js";
import { patchRange } from "../_lib/patches.js";

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCsv(headers, rows) {
  const out = [headers.map(csvEscape).join(",")];
  for (const row of rows) {
    out.push(headers.map((h) => csvEscape(row[h])).join(","));
  }
  return out.join("\r\n") + "\r\n";
}

function isoOrEmpty(ms) {
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toISOString();
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  res.setHeader("cache-control", "private, no-store");

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
  const adminId = process.env.ADMIN_DISCORD_ID || "";
  if (!adminId || String(session.userId) !== String(adminId)) {
    return res.status(403).json({ error: "Admin access required" });
  }

  const type = String(req.query?.type || "").toLowerCase();
  const patchVersion = String(req.query?.patch || "");

  if (type !== "refineries" && type !== "logins") {
    return res
      .status(400)
      .json({ error: "type must be 'refineries' or 'logins'" });
  }

  const range = patchRange(patchVersion);
  if (!range) {
    return res
      .status(400)
      .json({ error: `Unknown or unreleased patch: ${patchVersion}` });
  }

  const filenameSafe = patchVersion.replace(/[^0-9A-Za-z._-]/g, "_");
  const fname = `scsalvager_${type}_${filenameSafe}.csv`;
  res.setHeader("content-type", "text/csv; charset=utf-8");
  res.setHeader("content-disposition", `attachment; filename="${fname}"`);

  if (type === "refineries") {
    const userIds = await listUserIds(redis);
    const rows = [];
    for (const userId of userIds) {
      let ledger;
      try {
        ledger = (await redis.get(ledgerKey(userId))) || {};
      } catch {
        continue;
      }
      const meta = await getUserMeta(redis, userId);
      const username = (meta && meta.username) || "Unknown";
      const jobs = Array.isArray(ledger.refineryJobs) ? ledger.refineryJobs : [];
      for (const j of jobs) {
        if (!Number.isFinite(j?.submittedAt)) continue;
        if (j.submittedAt < range.from || j.submittedAt >= range.to) continue;
        rows.push({
          username,
          userId,
          jobId: j.id || "",
          material: j.material || "",
          materialScu: Number.isFinite(j.materialScu) ? j.materialScu : "",
          location: j.location || "",
          method: j.method || "",
          yieldScu: Number.isFinite(j.yield) ? j.yield : "",
          costAuec: Number.isFinite(j.cost) ? j.cost : "",
          submittedAt: isoOrEmpty(j.submittedAt),
          completesAt: isoOrEmpty(j.completesAt),
          pickedUpAt: isoOrEmpty(j.pickedUpAt),
          notificationStatus: j.notificationStatus || "",
        });
      }
    }
    rows.sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
    const csv = toCsv(
      [
        "username",
        "userId",
        "jobId",
        "material",
        "materialScu",
        "location",
        "method",
        "yieldScu",
        "costAuec",
        "submittedAt",
        "completesAt",
        "pickedUpAt",
        "notificationStatus",
      ],
      rows
    );
    return res.status(200).send(csv);
  }

  // type === "logins"
  const events = await listLoginsInRange(redis, range.from, range.to);
  // Resolve usernames once per unique userId.
  const uniqueIds = Array.from(new Set(events.map((e) => e.userId)));
  const usernameByUserId = {};
  for (const userId of uniqueIds) {
    const meta = await getUserMeta(redis, userId);
    usernameByUserId[userId] = (meta && meta.username) || "Unknown";
  }
  const rows = events
    .map((e) => ({
      username: usernameByUserId[e.userId] || "Unknown",
      userId: e.userId,
      loggedInAt: isoOrEmpty(e.timestampMs),
    }))
    .sort((a, b) => a.loggedInAt.localeCompare(b.loggedInAt));

  const csv = toCsv(["username", "userId", "loggedInAt"], rows);
  return res.status(200).send(csv);
}
