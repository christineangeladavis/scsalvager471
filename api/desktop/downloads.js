// GET /api/desktop/downloads
//
// Returns the latest desktop release version + per-platform
// download URLs sourced from the matching GitHub Release. Drives
// the Settings → Desktop App download buttons + the GitHub
// Releases-mirror UX.
//
// Response shape:
//   {
//     version: "0.2.0",
//     publishedAt: "2026-05-10T...",
//     releaseUrl: "https://github.com/.../releases/tag/desktop-v0.2.0",
//     downloads: {
//       "windows": { url, name, size },
//       "macos": { url, name, size },
//       "linux": { url, name, size }
//     }
//   }
//
// Each platform key is null when no installer for that target
// shipped in the release. Cached 5 min so the GitHub API rate
// limit doesn't matter even with broad traffic.

const RELEASES_URL =
  "https://api.github.com/repos/ChrissyNightingale/scsalvager471/releases";

// Filename suffixes per platform — we want the "user-facing"
// installer (MSI / NSIS .exe / DMG / AppImage), NOT the .tar.gz
// updater bundle that tauri-action also uploads.
const PLATFORM_PATTERNS = {
  windows: /\.msi$|-setup\.exe$/i,
  macos: /\.dmg$/i,
  linux: /\.AppImage$|\.deb$/i,
};

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  res.setHeader("cache-control", "public, max-age=300");

  let releases = [];
  try {
    const headers = {
      Accept: "application/vnd.github+json",
      "User-Agent": "scsalvager-desktop-downloads",
    };
    // Repo is private — without an auth token GitHub returns 404
    // for /releases. Operator stores a fine-grained PAT
    // (contents:read on this repo) as GITHUB_RELEASE_TOKEN in
    // Vercel project env vars. Endpoint degrades to version:null
    // when the token is missing or invalid.
    const ghToken = process.env.GITHUB_RELEASE_TOKEN;
    if (ghToken) headers.Authorization = `Bearer ${ghToken}`;
    const ghRes = await fetch(RELEASES_URL, { headers });
    if (!ghRes.ok) {
      console.warn("[downloads] GitHub returned", ghRes.status);
      return res.status(200).json({ version: null, downloads: {} });
    }
    releases = await ghRes.json();
  } catch (e) {
    console.warn("[downloads] GitHub fetch failed:", e && e.message ? e.message : e);
    return res.status(200).json({ version: null, downloads: {} });
  }

  // Pick the newest non-prerelease whose tag starts with
  // "desktop-v". Releases API returns newest first.
  const release = (Array.isArray(releases) ? releases : []).find(
    (r) =>
      r &&
      !r.draft &&
      !r.prerelease &&
      typeof r.tag_name === "string" &&
      r.tag_name.startsWith("desktop-v")
  );
  if (!release) {
    return res.status(200).json({ version: null, downloads: {} });
  }

  const version = String(release.tag_name).replace(/^desktop-v/, "");
  const downloads = {};
  const assets = Array.isArray(release.assets) ? release.assets : [];
  for (const [platform, pattern] of Object.entries(PLATFORM_PATTERNS)) {
    const match = assets.find((a) => pattern.test(a.name));
    downloads[platform] = match
      ? {
          url: match.browser_download_url,
          name: match.name,
          size: match.size,
        }
      : null;
  }

  return res.status(200).json({
    version,
    publishedAt: release.published_at,
    releaseUrl: release.html_url,
    downloads,
  });
}
