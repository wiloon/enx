// ADR-075: find a site's two newest article pages for corpus.json.
//
//   task article-eval-discover -- <site homepage URL>
//   task article-eval-discover -- <site homepage URL> --skip <article URL>
//
// Prints JSON: { site, candidates: [{ url, date, source }], failures:
// [{ url, error }] }. Exits 1 when fewer than two articles were found. The
// operator adds the candidates to corpus.json with the site's category;
// `--skip` (repeatable) passes over pages that failed screening.

import { gunzipSync } from 'node:zlib'
import {
  discoverArticles,
  type FetchedResource,
} from '../src/lib/articleEval/discovery.ts'

const TIMEOUT_MS = 15_000
const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

async function fetchResource(url: string): Promise<FetchedResource> {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: { 'user-agent': USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  return {
    status: response.status,
    url: response.url || url,
    body: new Uint8Array(await response.arrayBuffer()),
  }
}

const USAGE =
  'usage: task article-eval-discover -- <site homepage URL> [--skip <article URL>]...'

function parseArgs(args: string[]) {
  let site = ''
  const skip: string[] = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--skip' && args[i + 1]) skip.push(new URL(args[++i]).href)
    else if (!site && !args[i].startsWith('--')) site = new URL(args[i]).href
    else throw new Error(`unknown argument: ${args[i]}\n${USAGE}`)
  }
  if (!site) throw new Error(USAGE)
  return { site, skip }
}

async function main() {
  const { site, skip } = parseArgs(process.argv.slice(2))
  const result = await discoverArticles(
    site,
    {
      fetch: fetchResource,
      gunzip: bytes => new Uint8Array(gunzipSync(bytes)),
    },
    {},
    skip
  )
  for (const failure of result.failures) {
    console.error(`failed: ${failure.url}  ${failure.error}`)
  }
  console.log(JSON.stringify(result, null, 2))
  if (result.candidates.length < 2) process.exitCode = 1
}

await main()
