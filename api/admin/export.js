// GET /api/admin/export?type=<refineries|sales|logins|all>&patch=<vX.Y.Z>&format=<csv|xlsx>
//
// Admin-only. Streams a CSV or XLSX file scoped to a Star Citizen patch's
// release cycle. Patch metadata lives in api/_lib/patches.js.
//
// Types:
//   refineries — every refinery job submitted in [from, to)
//   sales      — every sell order submitted in [from, to)
//   logins     — every login event recorded in [from, to)
//   all        — all three combined into a single file
//                  · xlsx: one workbook, 3 sheets
//                  · csv: one file with 3 sections, each prefixed by a
//                    "## <section name> ##" header row
//
// Format defaults to csv when not provided. xlsx uses the xlsx package
// loaded on demand to keep cold-start size down.

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

async function toXlsxBuffer(headers, rows, sheetName) {
  // Dynamic import so the cold-start cost only applies to xlsx requests.
  const XLSX = await import("xlsx");
  // header:[] tells json_to_sheet the column order; otherwise it picks
  // alphabetical which would scramble the output.
  const sheet = XLSX.utils.json_to_sheet(rows, { header: headers });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, sheetName.slice(0, 31));
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

function isoOrEmpty(ms) {
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toISOString();
}

// "Status" derived from job timestamps:
//   cancelled — user discarded/deleted the job (deletedAt set)
//   picked_up — user collected the refined material (pickedUpAt set)
//   ready     — timer elapsed, awaiting pickup
//   in_progress — timer still running
function refineryJobStatus(j, now) {
  if (j.deletedAt) return "cancelled";
  if (j.pickedUpAt) return "picked_up";
  if (Number.isFinite(j.completesAt) && j.completesAt <= now) return "ready";
  return "in_progress";
}

async function buildRefineryRows(redis, range) {
  const userIds = await listUserIds(redis);
  const now = Date.now();
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
        status: refineryJobStatus(j, now),
        material: j.material || "",
        materialScu: Number.isFinite(j.materialScu) ? j.materialScu : "",
        location: j.location || "",
        method: j.method || "",
        yieldScu: Number.isFinite(j.yield) ? j.yield : "",
        costAuec: Number.isFinite(j.cost) ? j.cost : "",
        submittedAt: isoOrEmpty(j.submittedAt),
        completesAt: isoOrEmpty(j.completesAt),
        pickedUpAt: isoOrEmpty(j.pickedUpAt),
        deletedAt: isoOrEmpty(j.deletedAt),
        notificationStatus: j.notificationStatus || "",
      });
    }
  }
  rows.sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
  return rows;
}

async function buildSalesRows(redis, range) {
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
    const orders = Array.isArray(ledger.sellOrders) ? ledger.sellOrders : [];
    for (const o of orders) {
      if (!Number.isFinite(o?.submittedAt)) continue;
      if (o.submittedAt < range.from || o.submittedAt >= range.to) continue;
      // Status precedence: full delete wins over dismiss-from-recent.
      const status = o.deletedAt
        ? "deleted"
        : o.dismissedFromRecentAt
          ? "dismissed_from_recent"
          : "active";
      rows.push({
        username,
        userId,
        orderId: o.id || "",
        status,
        material: o.material || "",
        scu: Number.isFinite(o.scu) ? o.scu : "",
        aUEC: Number.isFinite(o.aUEC) ? o.aUEC : "",
        location: o.location || "",
        playerName: o.playerName || "",
        submittedAt: isoOrEmpty(o.submittedAt),
        deletedAt: isoOrEmpty(o.deletedAt),
        dismissedFromRecentAt: isoOrEmpty(o.dismissedFromRecentAt),
      });
    }
  }
  rows.sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
  return rows;
}

async function buildLoginRows(redis, range) {
  const events = await listLoginsInRange(redis, range.from, range.to);
  const uniqueIds = Array.from(new Set(events.map((e) => e.userId)));
  const usernameByUserId = {};
  for (const userId of uniqueIds) {
    const meta = await getUserMeta(redis, userId);
    usernameByUserId[userId] = (meta && meta.username) || "Unknown";
  }
  return events
    .map((e) => ({
      username: usernameByUserId[e.userId] || "Unknown",
      userId: e.userId,
      loggedInAt: isoOrEmpty(e.timestampMs),
    }))
    .sort((a, b) => a.loggedInAt.localeCompare(b.loggedInAt));
}

const TYPE_CONFIG = {
  refineries: {
    headers: [
      "username",
      "userId",
      "jobId",
      "status",
      "material",
      "materialScu",
      "location",
      "method",
      "yieldScu",
      "costAuec",
      "submittedAt",
      "completesAt",
      "pickedUpAt",
      "deletedAt",
      "notificationStatus",
    ],
    sheetName: "Refinery Jobs",
    build: buildRefineryRows,
  },
  sales: {
    headers: [
      "username",
      "userId",
      "orderId",
      "status",
      "material",
      "scu",
      "aUEC",
      "location",
      "playerName",
      "submittedAt",
      "deletedAt",
      "dismissedFromRecentAt",
    ],
    sheetName: "Sell Orders",
    build: buildSalesRows,
  },
  logins: {
    headers: ["username", "userId", "loggedInAt"],
    sheetName: "Logins",
    build: buildLoginRows,
  },
};

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
  const format = (String(req.query?.format || "csv").toLowerCase() === "xlsx") ? "xlsx" : "csv";

  const range = patchRange(patchVersion);
  if (!range) {
    return res.status(400).json({ error: `Unknown or unreleased patch: ${patchVersion}` });
  }

  const filenameSafe = patchVersion.replace(/[^0-9A-Za-z._-]/g, "_");
  const ext = format === "xlsx" ? "xlsx" : "csv";

  // Combined export: all three types in a single file.
  if (type === "all") {
    const allTypes = ["refineries", "sales", "logins"];
    const sections = [];
    for (const t of allTypes) {
      const cfg = TYPE_CONFIG[t];
      sections.push({
        type: t,
        cfg,
        rows: await cfg.build(redis, range),
      });
    }

    const fname = `scsalvager_all_${filenameSafe}.${ext}`;
    res.setHeader("content-disposition", `attachment; filename="${fname}"`);

    if (format === "xlsx") {
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();
      for (const s of sections) {
        const sheet = XLSX.utils.json_to_sheet(s.rows, { header: s.cfg.headers });
        XLSX.utils.book_append_sheet(wb, sheet, s.cfg.sheetName.slice(0, 31));
      }
      const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      res.setHeader(
        "content-type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      return res.status(200).send(buffer);
    }

    // CSV all-in-one: section header rows separate the three datasets.
    // Not strictly "valid" CSV (the section markers are extra rows), but
    // human-readable and importable as a single sheet.
    const parts = sections.map(
      (s) => `## ${s.cfg.sheetName} ##\r\n${toCsv(s.cfg.headers, s.rows)}`
    );
    const csv = parts.join("\r\n");
    res.setHeader("content-type", "text/csv; charset=utf-8");
    return res.status(200).send(csv);
  }

  // Single-type export.
  const cfg = TYPE_CONFIG[type];
  if (!cfg) {
    return res.status(400).json({
      error: "type must be 'refineries', 'sales', 'logins', or 'all'",
    });
  }

  const rows = await cfg.build(redis, range);
  const fname = `scsalvager_${type}_${filenameSafe}.${ext}`;

  if (format === "xlsx") {
    const buffer = await toXlsxBuffer(cfg.headers, rows, cfg.sheetName);
    res.setHeader(
      "content-type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("content-disposition", `attachment; filename="${fname}"`);
    return res.status(200).send(buffer);
  }

  const csv = toCsv(cfg.headers, rows);
  res.setHeader("content-type", "text/csv; charset=utf-8");
  res.setHeader("content-disposition", `attachment; filename="${fname}"`);
  return res.status(200).send(csv);
}
