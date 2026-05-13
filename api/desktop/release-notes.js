// GET /api/desktop/release-notes
//
// Returns DESKTOP_README.md's content as plain text so the
// Settings → Desktop App → "Release notes →" modal can render
// without baking each version's bullets into App.jsx. Every
// desktop release just needs to add a new section at the top of
// DESKTOP_README.md and the modal picks it up automatically.
//
// Response: text/markdown with the canonical README body. Cached
// edge-side for 5 minutes so the GitHub-raw fetch doesn't fan out
// on every Settings open.

const RAW_URL =
  "https://raw.githubusercontent.com/ChrissyNightingale/scsalvager471/main/DESKTOP_README.md";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  // Edge cache for 5 minutes — Settings opens are infrequent +
  // bursty (every time a user opens Settings), and the markdown
  // file only changes per-release. SWR keeps stale content fresh
  // in the background.
  res.setHeader(
    "cache-control",
    "public, max-age=60, s-maxage=300, stale-while-revalidate=900"
  );

  try {
    const ghRes = await fetch(RAW_URL, {
      headers: { "User-Agent": "scsalvager-desktop-release-notes" },
    });
    if (!ghRes.ok) {
      return res
        .status(502)
        .send(`# Release notes\n\nCould not load DESKTOP_README.md (HTTP ${ghRes.status}).`);
    }
    const body = await ghRes.text();
    res.setHeader("content-type", "text/markdown; charset=utf-8");
    return res.status(200).send(body);
  } catch (e) {
    console.error(
      "[release-notes] fetch failed:",
      e && e.message ? e.message : e
    );
    return res.status(502).send(`# Release notes\n\nCould not load DESKTOP_README.md.`);
  }
}
