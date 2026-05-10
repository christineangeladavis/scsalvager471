// GET /api/desktop/manifest?target=<windows|darwin|linux>&arch=<x86_64|aarch64>&current_version=<x>
//
// Tauri-format auto-update manifest for the SCSalvager Desktop app.
// The Tauri updater plugin polls this endpoint on every app launch
// (after a 15 s grace period), passing the running app's target +
// arch + current_version as query params. We respond with a JSON
// manifest pointing at the matching signed installer hosted on the
// GitHub release.
//
// Wire-up:
//   1. GitHub Actions matrix builds Win MSI / macOS DMG / Linux
//      AppImage on tag push, signs each artifact with the operator's
//      minisign private key, and uploads them + the .sig files to
//      the GitHub Release.
//   2. This endpoint reads the latest non-prerelease GitHub release,
//      finds the asset matching the requesting platform, returns
//      the asset URL + the signature contents.
//
// Response shape (Tauri 2 updater):
//   {
//     "version": "0.2.0",
//     "notes": "<release body>",
//     "pub_date": "2026-05-10T00:00:00Z",
//     "platforms": {
//       "windows-x86_64": {
//         "signature": "<contents of .sig file>",
//         "url": "https://github.com/.../SCSalvager_0.2.0_x64.msi"
//       }
//     }
//   }
//
// 204 No Content is returned when no compatible artifact exists
// for the requesting target — the Tauri updater treats that as
// "up to date" and skips the install prompt.

const RELEASES_URL =
  "https://api.github.com/repos/christineangeladavis/scsalvager471/releases/latest";

// Maps the (target, arch) combo Tauri sends to the asset filename
// suffix the GitHub Actions build produces. Update both sides
// together when adding a new platform target.
const ASSET_BY_PLATFORM = {
  "windows-x86_64": { match: /_x64-setup\.nsis\.zip$|_x64\.msi\.zip$|_x64-setup\.exe\.zip$/i, key: "windows-x86_64" },
  "darwin-x86_64": { match: /_x64\.app\.tar\.gz$/i, key: "darwin-x86_64" },
  "darwin-aarch64": { match: /_aarch64\.app\.tar\.gz$/i, key: "darwin-aarch64" },
  "linux-x86_64": { match: /amd64\.AppImage\.tar\.gz$/i, key: "linux-x86_64" },
};

function platformKey(target, arch) {
  const t = (target || "").toLowerCase();
  const a = (arch || "").toLowerCase();
  if (t.startsWith("windows")) return "windows-x86_64";
  if (t.startsWith("darwin") || t.startsWith("macos")) {
    return a.includes("aarch64") || a.includes("arm64")
      ? "darwin-aarch64"
      : "darwin-x86_64";
  }
  if (t.startsWith("linux")) return "linux-x86_64";
  return null;
}

function isNewer(latest, current) {
  // Naive semver — splits on dot, compares numeric prefixes. Good
  // enough for "0.2.0" vs "0.1.0" without dragging in a semver lib.
  const parse = (v) =>
    String(v || "")
      .replace(/^v/, "")
      .split(/[.-]/)
      .map((s) => Number.parseInt(s, 10) || 0);
  const a = parse(latest);
  const b = parse(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  res.setHeader("cache-control", "public, max-age=300");

  const target = (req.query && req.query.target) || "";
  const arch = (req.query && req.query.arch) || "";
  const currentVersion = (req.query && req.query.current_version) || "0.0.0";
  const platform = platformKey(target, arch);
  if (!platform) {
    return res.status(204).end();
  }

  let release;
  try {
    const ghRes = await fetch(RELEASES_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "scsalvager-desktop-manifest",
      },
    });
    if (!ghRes.ok) {
      // No release yet, or rate-limited. Tell the updater "up to
      // date" so it backs off until we ship a real release.
      return res.status(204).end();
    }
    release = await ghRes.json();
  } catch (e) {
    console.warn("[manifest] fetch latest release failed:", e && e.message ? e.message : e);
    return res.status(204).end();
  }

  const releaseVersion = String(release.tag_name || "").replace(/^v/, "");
  if (!releaseVersion || !isNewer(releaseVersion, currentVersion)) {
    return res.status(204).end();
  }

  const matcher = ASSET_BY_PLATFORM[platform];
  if (!matcher) return res.status(204).end();
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const installerAsset = assets.find((a) => matcher.match.test(a.name));
  if (!installerAsset) return res.status(204).end();
  // Tauri's signature ships in a sibling .sig file uploaded next
  // to the installer.
  const sigAsset = assets.find((a) => a.name === `${installerAsset.name}.sig`);
  if (!sigAsset) {
    console.warn(
      "[manifest] missing .sig sibling for asset",
      installerAsset.name
    );
    return res.status(204).end();
  }

  let signature;
  try {
    const sigRes = await fetch(sigAsset.browser_download_url, {
      headers: { "User-Agent": "scsalvager-desktop-manifest" },
    });
    if (!sigRes.ok) {
      console.warn("[manifest] sig fetch failed:", sigRes.status);
      return res.status(204).end();
    }
    signature = (await sigRes.text()).trim();
  } catch (e) {
    console.warn("[manifest] sig fetch error:", e && e.message ? e.message : e);
    return res.status(204).end();
  }

  return res.status(200).json({
    version: releaseVersion,
    notes: release.body || "",
    pub_date: release.published_at || new Date().toISOString(),
    platforms: {
      [matcher.key]: {
        signature,
        url: installerAsset.browser_download_url,
      },
    },
  });
}
