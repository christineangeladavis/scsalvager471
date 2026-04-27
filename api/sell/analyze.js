// POST /api/sell/analyze
//
// Accepts a screenshot of an in-game Star Citizen Commodities / Trading
// Console screen and returns structured fields for auto-filling the
// Ledger's Sell Orders form (plus the per-SCU price for the Report a
// Price widget). The image is held in memory only for the Anthropic
// vision API call — never written to disk, never persisted to Redis,
// never logged.
//
// Body shape:
//   { imageBase64: "<base64>", mediaType: "image/png" | "image/jpeg" }
//
// Response shape (any field may be null when the model can't read it):
//   {
//     materialName: string | null,    // e.g. "Diamond" / "Construction Materials"
//     scu: number | null,             // quantity being sold (integer)
//     locationName: string | null,    // e.g. "HUR-L1 Green Glade Station"
//     totalAuec: number | null,       // total aUEC for the transaction
//     pricePerScu: number | null      // unit price per SCU
//   }
//
// Field order in both the prompt and the response is intentional —
// Material first so the form can fill it before the dependent Sell
// Location dropdown becomes enabled, then Amount, then Location, then
// the price fields.
//
// Auth: requires a logged-in session.
// Required env var: ANTHROPIC_API_KEY.

import { getRedis } from "../_lib/redis.js";
import { getSession } from "../_lib/session.js";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
const ANTHROPIC_VERSION = "2023-06-01";

const EXTRACTION_PROMPT = `You are reading a Star Citizen Commodities / Trading Console screen.

Extract the following fields from the image and return them as a single JSON object. Use null for any field you cannot confidently read. Do NOT invent values.

Read the fields in this order — Material first, Amount second, then Location, then the aUEC totals. The first two are the most important; if you can only read part of the screen, prioritise getting those right.

Fields (return them in this order):
- materialName: the commodity being sold under "IN DEMAND". Use the name as printed (string). Examples: "Diamond", "Construction Materials", "Recycled Material Composite".
- scu: the quantity being sold in SCU (integer). Use the largest highlighted "AVAILABLE CARGO SIZE" the user has selected, or the totals row.
- locationName: the trading station name shown at the top of the "YOUR INVENTORIES" panel (string). Examples: "HUR-L1 Green Glade Station", "ARC-L4", "Levski".
- totalAuec: the total aUEC the player will receive for this transaction (integer). Convert any M / K suffixes — "1.461M" -> 1461000, "12.5K" -> 12500.
- pricePerScu: the unit price shown next to the commodity (integer aUEC per SCU). Convert any M / K suffixes — "5.70900011K/SCU" -> 5709.

Return ONLY the JSON object on a single line, with keys in the order listed above. No prose, no markdown fences.`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  res.setHeader("cache-control", "private, no-store");

  let redis;
  try {
    redis = getRedis();
  } catch (e) {
    return res.status(503).json({ error: "Storage unavailable" });
  }
  const session = await getSession(req, redis);
  if (!session) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error:
        "Sell-screenshot analysis is not configured on the server. The site owner needs to set ANTHROPIC_API_KEY in the Vercel project environment.",
    });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  if (!body || typeof body !== "object") {
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  const imageBase64 = typeof body.imageBase64 === "string" ? body.imageBase64 : "";
  const mediaType = typeof body.mediaType === "string" ? body.mediaType : "image/png";

  if (!imageBase64) {
    return res.status(400).json({ error: "Missing imageBase64" });
  }
  if (!/^image\/(png|jpeg|webp|gif)$/.test(mediaType)) {
    return res.status(400).json({ error: "Unsupported mediaType" });
  }
  if (imageBase64.length > Math.ceil((MAX_IMAGE_BYTES * 4) / 3)) {
    return res.status(413).json({ error: "Image too large" });
  }

  let apiResp;
  try {
    apiResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 512,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: mediaType,
                  data: imageBase64,
                },
              },
              { type: "text", text: EXTRACTION_PROMPT },
            ],
          },
        ],
      }),
    });
  } catch (e) {
    console.error("sell/analyze: Anthropic fetch failed:", e && e.message ? e.message : e);
    return res.status(502).json({ error: "Could not reach analysis API" });
  }

  if (!apiResp.ok) {
    const detail = await apiResp.text().catch(() => "");
    console.error("sell/analyze: Anthropic API error", apiResp.status, detail.slice(0, 500));
    return res.status(502).json({ error: `Analysis API returned HTTP ${apiResp.status}` });
  }

  let payload;
  try {
    payload = await apiResp.json();
  } catch {
    return res.status(502).json({ error: "Invalid response from analysis API" });
  }

  const text =
    Array.isArray(payload?.content) &&
    payload.content.find((c) => c?.type === "text")?.text;
  if (!text) {
    return res.status(502).json({ error: "Analysis API returned no text" });
  }

  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    console.error("sell/analyze: failed to parse JSON from model:", stripped.slice(0, 200));
    return res.status(502).json({ error: "Could not parse analysis result" });
  }

  const num = (v) =>
    Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v)) : null;

  // Keys ordered to match the prompt: Material, Amount, Location, aUEC totals.
  return res.status(200).json({
    materialName: typeof parsed.materialName === "string" ? parsed.materialName : null,
    scu: num(parsed.scu),
    locationName: typeof parsed.locationName === "string" ? parsed.locationName : null,
    totalAuec: num(parsed.totalAuec),
    pricePerScu: num(parsed.pricePerScu),
  });
}
