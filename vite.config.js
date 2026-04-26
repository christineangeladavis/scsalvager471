import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

function getBuildVersion() {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA;
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return `dev-${Date.now()}`;
  }
}

const buildVersion = getBuildVersion();

// Emits dist/version.json on build, and serves a synthetic /version.json
// in dev. The dev middleware optionally reads .claude/dev-version-override
// (untracked) so the value can be flipped without restarting the dev server
// — useful for exercising the "new update available" banner locally.
function versionJsonPlugin() {
  return {
    name: 'version-json',
    writeBundle(options) {
      const outDir = options.dir || 'dist';
      writeFileSync(
        resolve(outDir, 'version.json'),
        JSON.stringify({ version: buildVersion }) + '\n'
      );
    },
    configureServer(server) {
      // Register *before* Vite's internal middlewares so our handler wins
      // over the SPA-fallback transformIndexHtml middleware for /version.json.
      server.middlewares.use('/version.json', (req, res) => {
        let value = buildVersion;
        try {
          const override = readFileSync('.claude/dev-version-override', 'utf8').trim();
          if (override) value = override;
        } catch {
          // no override file — use build version
        }
        res.setHeader('content-type', 'application/json');
        res.setHeader('cache-control', 'no-store');
        res.end(JSON.stringify({ version: value }));
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), versionJsonPlugin()],
  define: {
    __BUILD_VERSION__: JSON.stringify(buildVersion),
  },
  build: { outDir: 'dist', assetsInlineLimit: 0 },
  test: {
    environment: 'node',
    globals: true,
  },
})
