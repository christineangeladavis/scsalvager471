// POST /api/refinery/analyze
//
// Accepts a screenshot of an in-game Star Citizen refinery setup screen
// and returns structured fields for auto-filling the Ledger's refinery
// job form. The image is held in memory only for the Anthropic vision
// API call — never written to disk, never persisted to Redis, never
// logged. Once the response is sent back to the client the buffer is
// out of scope and the runtime GCs it.
//
// Body shape:
//   { imageBase64: "<base64 string>", mediaType: "image/png" | "image/jpeg" }
//
// Response shape (any field may be null when the model can't see it):
//   {
//     rawMaterialName: string | null,        // e.g. "Construction Salvage"
//     totalSCU: number | null,               // e.g. 9.21 (server divides by 100 for cSCU -> SCU)
//     locationName: string | null,           // e.g. "ARC-L2 Lively Pathway Station"
//     methodName: string | null,             // e.g. "XCR Reaction"
//     processingTimeSeconds: number | null,  // e.g. 271 (4m 31s)
//     costAUEC: number | null                // e.g. 1152 (refinery fee paid up front)
//   }
//
// Field order in both the prompt and the response is intentional —
// Material comes first so the model anchors on it (and so the client
// can fill the Material dropdown before any dependent dropdowns), then
// Amount, then Location/Method, then Time, then Cost.
//
// Auth: requires a logged-in session (any user).
//
// Required env var: ANTHROPIC_API_KEY (set in Vercel project env vars).

import { getRedis } from "../_lib/redis.js";
import { getSession } from "../_lib/session.js";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB after base64 decode
const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
const ANTHROPIC_VERSION = "2023-06-01";

const EXTRACTION_PROMPT = `You are reading a Star Citizen refinery order screen.

Extract the following fields from the image and return them as a single JSON object. Use null for any field you cannot confidently read. Do NOT invent values.

Read the fields in this order — Material first, Amount second, then Location, Method, Time, and Cost. The first two are the most important; if you can only read part of the screen, prioritise getting those right.

Fields (return them in this order):
- rawMaterialName: the primary raw material being refined. If multiple materials are listed, return the one with the highest QTY. Include the parenthetical suffix as shown. Examples: "Iron (Ore)", "Construction Salvage", "Construction Pieces".
- totalSCU: the "TO REFINE" total quantity AS PRINTED on the screen (integer). The in-game refinery setup screen lists quantities in cSCU (1 SCU = 100 cSCU); just return the raw on-screen number — the server divides by 100 to get SCU.
- locationName: the refinery station name shown at the top of the screen (string). Examples: "ARC-L2 Lively Pathway Station", "Levski", "HUR-L1".
- methodName: the processing/refinery method shown under "PROCESSING SELECTION, YIELD AND COSTS" (string). Examples: "XCR Reaction", "Cormack Method", "Dinyx Solventation".
- processingTimeSeconds: the processing time converted to total seconds (integer). E.g. "4m 31s" -> 271, "1h 30m" -> 5400.
- costAUEC: the total refinery cost / fee in aUEC the player will be charged for the job (integer). This is the up-front fee, NOT the expected sale value. Convert any M / K suffixes — "1.4K aUEC" -> 1400.

Return ONLY the JSON object on a single line, with keys in the order listed above. No prose, no markdown fences.`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  res.setHeader("cache-control", "private, no-store");

  // Auth: any logged-in user can use this. Redis only needed to read the
  // session cookie; analysis itself doesn't touch Redis.
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
        "Refinery analysis is not configured on the server. The site owner needs to set ANTHROPIC_API_KEY in the Vercel project environment.",
    });
  }

  // Parse body. Vercel auto-parses JSON when content-type matches; tolerate
  // string bodies just in case.
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
  // Rough size guard — base64 expands by ~4/3, so 8 MB binary ~= 10.6 MB base64.
  if (imageBase64.length > Math.ceil((MAX_IMAGE_BYTES * 4) / 3)) {
    return res.status(413).json({ error: "Image too large" });
  }

  // Call Anthropic Messages API with vision input.
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
    console.error("analyze: Anthropic fetch failed:", e && e.message ? e.message : e);
    return res.status(502).json({ error: "Could not reach analysis API" });
  }

  if (!apiResp.ok) {
    const detail = await apiResp.text().catch(() => "");
    console.error("analyze: Anthropic API error", apiResp.status, detail.slice(0, 500));
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

  // Strip code fences if the model wrapped the JSON anyway.
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(stripped);
  } catch (e) {
    console.error("analyze: failed to parse JSON from model:", stripped.slice(0, 200));
    return res.status(502).json({ error: "Could not parse analysis result" });
  }

  // Coerce types and clamp ranges.
  // The model is asked to return totalSCU as the raw on-screen number;
  // the in-game refinery screen shows quantities in cSCU (1 SCU = 100
  // cSCU), so divide by 100 here to land on canonical SCU. Keep two
  // decimal places — the underlying data is integer cSCU so this is
  // exactly representable.
  const rawTotal = Number(parsed.totalSCU);
  const totalSCU =
    Number.isFinite(rawTotal) && rawTotal >= 0
      ? Math.round(rawTotal) / 100
      : null;

  // Keys ordered to match the prompt: Material, Amount, Location,
  // Method, Time, Cost.
  const out = {
    rawMaterialName: typeof parsed.rawMaterialName === "string" ? parsed.rawMaterialName : null,
    totalSCU,
    locationName: typeof parsed.locationName === "string" ? parsed.locationName : null,
    methodName: typeof parsed.methodName === "string" ? parsed.methodName : null,
    processingTimeSeconds:
      Number.isFinite(Number(parsed.processingTimeSeconds)) &&
      Number(parsed.processingTimeSeconds) >= 0
        ? Math.round(Number(parsed.processingTimeSeconds))
        : null,
    costAUEC:
      Number.isFinite(Number(parsed.costAUEC)) && Number(parsed.costAUEC) >= 0
        ? Math.round(Number(parsed.costAUEC))
        : null,
  };

  return res.status(200).json(out);
}
