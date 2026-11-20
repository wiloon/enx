// Production launcher (ADR-036 Decision 3): validates AUTH_PROVIDER, then
// loads the generated standalone server.js from the working directory.
//
// A bad AUTH_PROVIDER must stop the process at start-up with a readable
// message rather than surface as a 500 on the first request. Node strips the
// types of the shared resolver, so this and the server adapter apply one rule.
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveAuthProvider } from '../src/lib/authProvider.ts'

try {
  resolveAuthProvider(process.env.AUTH_PROVIDER)
} catch (err) {
  console.error(`enx-ui: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}

await import(pathToFileURL(path.resolve(process.cwd(), 'server.js')).href)
