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
  "https://api.github.com/repos/ChrissyNightingale/scsalvager471/releases/latest";

// Maps the (target, arch) combo Tauri sends to the asset filename
// suffix the GitHub Actions build produces. Update both sides
// together when adding a new platform target.
// darwin-x86_64 dropped from the matrix — Intel macOS runners on
// GHA have a tiny pool and most Mac salvagers are on arm64. If
// Intel Mac demand surfaces, re-add the matrix entry + a
// "darwin-x86_64" line here.
const ASSET_BY_PLATFORM = {
  // Tauri 2's native updater format. On Windows + Linux the
  // updater downloads the raw installer (.exe / .AppImage) and
  // verifies it against a sibling .sig — no .zip / .tar.gz
  // wrapper. On macOS the updater still needs the .app.tar.gz
  // wrapper because it extracts + replaces the .app bundle in
  // place (Mac builds require the "app" bundle target in
  // tauri.conf.json — currently absent, so Mac auto-update is a
  // known gap until that target gets added on the next release).
  //
  // Patterns match both the canonical naming
  //   SCSalvager-Desktop-<os-label>_v<version><suffix>
  // and the legacy naming
  //   SCSalvager(-<os-label>)?_<version>_<arch><suffix>
  // so older releases on the GitHub side still resolve. The arch
  // token is optional in the regex; the OS label in the asset
  // name disambiguates per platform.
  "windows-x86_64": { match: /-setup\.exe$/i, key: "windows-x86_64" },
  "darwin-aarch64": { match: /\.app\.tar\.gz$/i, key: "darwin-aarch64" },
  "linux-x86_64": { match: /\.AppImage$/i, key: "linux-x86_64" },
};

function platformKey(target, arch) {
  const t = (target || "").toLowerCase();
  const a = (arch || "").toLowerCase();
  if (t.startsWith("windows")) return "windows-x86_64";
  if (t.startsWith("darwin") || t.startsWith("macos")) {
    // Only arm64 macOS is built today (see ASSET_BY_PLATFORM
    // comment). Intel Mac clients get null = 204 = "up to date".
    if (a.includes("aarch64") || a.includes("arm64")) {
      return "darwin-aarch64";
    }
    return null;
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
    const headers = {
      Accept: "application/vnd.github+json",
      "User-Agent": "scsalvager-desktop-manifest",
    };
    // Repo is private — auth token required for /releases.
    // Operator stores a fine-grained PAT (contents:read on this
    // repo) as GITHUB_RELEASE_TOKEN in Vercel env vars.
    const ghToken = process.env.GITHUB_RELEASE_TOKEN;
    if (ghToken) headers.Authorization = `Bearer ${ghToken}`;
    const ghRes = await fetch(RELEASES_URL, { headers });
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

  // Tag names are "desktop-v0.2.8" / "v1.0.0" / "0.2.0" depending on
  // the convention in use. Extract the semver core so the comparison
  // doesn't get derailed by the "desktop-" prefix. Falls back to the
  // raw tag if no semver match (rare — keeps the endpoint working
  // with hand-tagged releases).
  const tagName = String(release.tag_name || "");
  const semverMatch = tagName.match(/(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/);
  const releaseVersion = semverMatch ? semverMatch[1] : tagName.replace(/^v/, "");
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
    const sigHeaders = {
      "User-Agent": "scsalvager-desktop-manifest",
      Accept: "application/octet-stream",
    };
    // Asset downloads on a private repo require auth too.
    // Same fine-grained PAT (contents:read) works.
    const sigToken = process.env.GITHUB_RELEASE_TOKEN;
    if (sigToken) sigHeaders.Authorization = `Bearer ${sigToken}`;
    // For private-repo asset downloads, prefer the API endpoint
    // (api.github.com/.../assets/<id>) over browser_download_url.
    // The API endpoint accepts Bearer auth + Accept: octet-stream
    // and follows the redirect to the signed S3 URL automatically.
    const sigUrl = `https://api.github.com/repos/ChrissyNightingale/scsalvager471/releases/assets/${sigAsset.id}`;
    const sigRes = await fetch(sigUrl, {
      headers: sigHeaders,
      redirect: "follow",
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
