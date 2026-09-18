import { crx } from '@crxjs/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { defineConfig, loadEnv } from 'vite'
import manifest from './manifest.json'
import { buildManifest } from './src/config/manifest'
import { applyOverrides, DEFAULT_TARGET, resolveTargetName, TARGETS } from './src/config/targets'

// Read version from package.json
const packageJson = JSON.parse(readFileSync('./package.json', 'utf-8'))
const version = packageJson.version

export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // Vite automatically loads .env, .env.local, .env.[mode], .env.[mode].local files
  const env = loadEnv(mode, process.cwd(), '')

  // Which deployment this build points at: `vite build --mode production`
  // (or VITE_ENV=production) -> enx.wiloon.com, `--mode homelab` -> wiloon.lab.
  const targetName =
    resolveTargetName(env.VITE_ENV) ?? resolveTargetName(mode) ?? DEFAULT_TARGET
  const target = applyOverrides(TARGETS[targetName], env)

  console.log('🔧 Vite Config - mode:', mode)
  console.log('🔧 Vite Config - target:', targetName)
  console.log('🔧 Vite Config - API:', target.apiBaseUrl)
  console.log('🔧 Vite Config - UI:', target.frontendBaseUrl)

  return {
  plugins: [tailwindcss(), react(), crx({ manifest: buildManifest(manifest, target) as typeof manifest })],
  define: {
    __APP_VERSION__: JSON.stringify(version),
    // The runtime side of the target table (src/config/env.ts reads these).
    'import.meta.env.VITE_ENV': JSON.stringify(targetName),
    'import.meta.env.VITE_API_BASE_URL': JSON.stringify(target.apiBaseUrl),
    'import.meta.env.VITE_FRONTEND_BASE_URL': JSON.stringify(target.frontendBaseUrl),
    'import.meta.env.VITE_CLERK_PUBLISHABLE_KEY': JSON.stringify(target.clerkPublishableKey),
    'import.meta.env.VITE_CLERK_SYNC_HOST': JSON.stringify(target.clerkSyncHost),
    'import.meta.env.VITE_ENX_UI_ORIGINS': JSON.stringify(target.uiOrigins.join(',')),
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
      '@': resolve(__dirname, './src'),
    },
  },
  build: {
    // The large chunks are vendor code that's already appropriately code-split
    // and mostly lazy-loaded (Clerk's clerk-js + its per-feature chunks, incl.
    // the never-used Web3 wallet buttons behind a dynamic import; Sentry). The
    // 500 kB default just adds noise here -- ADR-015.
    chunkSizeWarningLimit: 1000,
  },
}
})
