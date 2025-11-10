import { crx } from '@crxjs/vite-plugin'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { defineConfig, loadEnv } from 'vite'
import manifest from './manifest.json'

// Read version from package.json
const packageJson = JSON.parse(readFileSync('./package.json', 'utf-8'))
const version = packageJson.version

export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // Vite automatically loads .env, .env.local, .env.[mode], .env.[mode].local files
  const env = loadEnv(mode, process.cwd(), '')

  console.log('🔧 Vite Config - mode:', mode)
  console.log('🔧 Vite Config - VITE_ENV from .env:', env.VITE_ENV)

  return {
  plugins: [react(), crx({ manifest })],
  define: {
    __APP_VERSION__: JSON.stringify(version),
    // Explicitly inject VITE_ENV for both dev and build modes
    'import.meta.env.VITE_ENV': JSON.stringify(env.VITE_ENV || (mode === 'development' ? 'development' : 'staging')),
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
}
})
