// Bundles src/articleEval/pageProbe.ts into an IIFE that defines the global
// `enxArticleEval` when injected into a page (ADR-070).

import { fileURLToPath } from 'node:url'
import { build, type Rollup } from 'vite'

export const PROBE_GLOBAL = 'enxArticleEval'

const src = fileURLToPath(new URL('../src', import.meta.url))

export async function buildProbe(): Promise<string> {
  const result = await build({
    configFile: false,
    logLevel: 'warn',
    resolve: { alias: { '@': src } },
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: {
      write: false,
      minify: false,
      lib: {
        entry: `${src}/articleEval/pageProbe.ts`,
        name: PROBE_GLOBAL,
        formats: ['iife'],
        fileName: () => 'probe.js',
      },
    },
  })
  const outputs = (
    Array.isArray(result) ? result : [result]
  ) as Rollup.RollupOutput[]
  const chunk = outputs
    .flatMap(output => output.output)
    .find(file => file.type === 'chunk')
  if (!chunk || chunk.type !== 'chunk')
    throw new Error('probe build emitted no chunk')
  return chunk.code
}
