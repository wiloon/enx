import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  // The standalone trace pulled in build-only tooling that the running server
  // never loads: typescript (9MB; reached via next.config.ts) and the whole
  // webpack tree (~650 files, plus terser and friends). Tracing them cost
  // build time ("Collecting build traces" ~1.5min in the homelab build) and
  // shipped ~17MB of dead weight in the image. Excluding the roots is enough:
  // nft does not follow imports out of an ignored file, so their dependency
  // trees drop out as well. scripts/smoke-runtime.sh guards the runtime side.
  outputFileTracingExcludes: {
    '*': [
      '**/node_modules/typescript/**',
      '**/node_modules/webpack/**',
      '**/node_modules/terser/**',
      '**/node_modules/terser-webpack-plugin/**',
    ],
  },
  // `/api/*` is NOT proxied via `rewrites()`: those are evaluated at build time
  // and frozen into the image, so API_BASE_URL would be ignored at runtime.
  // The relay lives in src/middleware.ts and reads API_BASE_URL per request.
}

export default nextConfig
