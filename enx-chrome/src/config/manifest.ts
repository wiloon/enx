// Build-time manifest stamping: manifest.json holds everything that is the same
// in every deployment, and this fills in the deployment-specific origins from
// the selected target (see targets.ts). Called from vite.config.ts.

import { clerkFrontendApiHost, type Target } from './targets'

interface ContentScript {
  matches?: string[]
  [key: string]: unknown
}

interface Manifest {
  host_permissions?: string[]
  content_scripts?: ContentScript[]
  [key: string]: unknown
}

const unique = (values: string[]): string[] => [...new Set(values)]

export function buildManifest(base: Manifest, target: Target): Manifest {
  const uiPatterns = target.uiOrigins.map(origin => `${origin}/*`)
  const clerkHost = clerkFrontendApiHost(target.clerkPublishableKey)

  // So a non-production build is recognisable in chrome://extensions and in the
  // toolbar, instead of two identical-looking "Catglish" entries.
  const nameSuffix =
    target.name === 'production'
      ? ''
      : ` (${target.name === 'homelab' ? 'Lab' : 'Dev'})`

  const hostPermissions = unique([
    ...(base.host_permissions ?? []),
    `${target.apiBaseUrl}/*`,
    ...uiPatterns,
    ...(clerkHost ? [`https://${clerkHost}/*`] : []),
  ])

  const contentScripts = (base.content_scripts ?? []).map((script, index) =>
    index === 0
      ? {
          ...script,
          matches: unique([...(script.matches ?? []), ...uiPatterns]),
        }
      : script
  )

  return {
    ...base,
    name: `${base.name as string}${nameSuffix}`,
    host_permissions: hostPermissions,
    content_scripts: contentScripts,
    // ADR-019: exactly the enx-ui origins, never more.
    externally_connectable: { matches: uiPatterns },
    // adr-034: content_scripts[0].matches only lists the sites that need
    // persistent auto-injection now (X/RSSX/enx-ui). CRXJS's content-script
    // loader dynamically imports the real bundle, and CRXJS scopes that
    // dynamic import's web_accessible_resources entry to
    // content_scripts[0].matches too (verified by inspecting the built
    // manifest -- @crxjs/vite-plugin's documented `defineDynamicResource`
    // escape hatch does NOT override this, the loader's own resource entry
    // still wins). So a page injected on demand (any other site, via
    // chrome.scripting.executeScript) has its import() blocked with
    // "Resources must be listed in the web_accessible_resources manifest
    // key". This second, wildcard entry keeps every built JS asset
    // loadable from any page regardless of that scoping -- Chrome allows a
    // resource to be covered by more than one web_accessible_resources
    // entry.
    web_accessible_resources: [
      { resources: ['assets/*'], matches: ['http://*/*', 'https://*/*'] },
    ],
  }
}
