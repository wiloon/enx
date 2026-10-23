import { crx, type ManifestV3Export } from '@crxjs/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { defineConfig, loadEnv } from 'vite'
import manifest from './manifest.json' with { type: 'json' }
import { gitCommit, gitVersion } from './scripts/version.mjs'
import { buildManifest } from './src/config/manifest.ts'
import { resolveBuildTarget, stampedEnv } from './src/config/targets.ts'

// The extension version comes from the nearest chrome-v* git tag (ADR-031
// §6a, src/config/version.ts): stamped into the manifest (buildManifest) and
// exposed to the UI as __APP_VERSION__.
const version = gitVersion()
// Shown beside the version in the popup footer's hover title (PopupVersion).
const commit = gitCommit()
const builtAt = new Date().toISOString()

export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // Vite automatically loads .env, .env.local, .env.[mode], .env.[mode].local files
  const env = loadEnv(mode, process.cwd(), '')

  // Which deployment this build points at: `vite build --mode production`
  // (or VITE_ENV=production) -> catglish.com, `--mode homelab` -> wiloon.lab.
  // Resolved here, at build time, and stamped into the bundle through `define`
  // below, so the bundle carries only this target -- never the whole table.
  const target = resolveBuildTarget(mode, env)
  const targetName = target.name

  console.log('🔧 Vite Config - mode:', mode)
  console.log('🔧 Vite Config - target:', targetName)
  console.log('🔧 Vite Config - API:', target.apiBaseUrl)
  console.log('🔧 Vite Config - UI:', target.frontendBaseUrl)

  return {
    plugins: [
      tailwindcss(),
      react(),
      crx({
        // Cast to crx's own type: `typeof manifest` lacks `version`, which
        // only exists once buildManifest has stamped it.
        manifest: buildManifest(
          manifest,
          target,
          version
        ) as unknown as ManifestV3Export,
      }),
    ],
    define: {
      __APP_VERSION__: JSON.stringify(version),
      // The selected target, the only one the bundle sees (src/config/env.ts
      // reads these back).
      ...Object.fromEntries(
        Object.entries(stampedEnv(target)).map(([key, value]) => [
          `import.meta.env.${key}`,
          JSON.stringify(value),
        ])
      ),
      'import.meta.env.VITE_BUILD_TIME': JSON.stringify(builtAt),
      // No git, no commit: leave it undefined rather than stamp "null".
      ...(commit && {
        'import.meta.env.VITE_BUILD_COMMIT': JSON.stringify(commit),
      }),
    },
    // Ensure VITE_ prefixed env vars are exposed
    envPrefix: 'VITE_',
    server: {
      port: 5173,
      strictPort: true,
      hmr: {
        port: 5173,
      },
      cors: true,
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
    },
    resolve: {
      alias: {
        '@': resolve(import.meta.dirname, './src'),
      },
    },
    build: {
      // Separate output dir per target so a homelab build and a production build
      // can sit on disk at the same time -- each gets loaded unpacked into its
      // own Chrome profile instead of one overwriting the other.
      outDir: `dist-${targetName}`,
      // The large chunks are vendor code that's already appropriately code-split
      // and mostly lazy-loaded (Clerk's clerk-js + its per-feature chunks, incl.
      // the never-used Web3 wallet buttons behind a dynamic import; Sentry). The
      // 500 kB default just adds noise here -- ADR-015.
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        // crxjs only bundles the pages the manifest names. ADR-050 dropped
        // side_panel.default_path (no window-wide panel), so the Side Panel
        // page -- opened per tab via chrome.sidePanel.setOptions -- is listed
        // here instead.
        input: { sidepanel: 'sidepanel.html' },
      },
    },
  }
})
