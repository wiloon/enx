// adr-039: the optional host permissions the user granted ARE the list of
// auto-enable sites -- nothing is stored besides Chrome's own grant record.
// This module keeps the dynamically registered content scripts in line with
// those grants and answers the content script's "should I turn on?".

import {
  isRequiredHost,
  isSitePattern,
  sitePatternFor,
  type AutoEnableManifest,
} from '@/lib/autoEnableSite'

const SCRIPT_ID_PREFIX = 'auto-enable:'

const manifest = () => chrome.runtime.getManifest() as AutoEnableManifest

// The same bundle the static content script and on-demand injection use
// (enableLearningMode.ts), so the hashed file name never drifts.
const contentScriptFiles = (): string[] =>
  manifest().content_scripts?.[0]?.js ?? []

export async function grantedAutoEnableSites(): Promise<string[]> {
  const { origins = [] } = await chrome.permissions.getAll()
  const m = manifest()
  return origins.filter(
    pattern => isSitePattern(pattern) && !isRequiredHost(pattern, m)
  )
}

export async function reconcileAutoEnableScripts(): Promise<void> {
  const staticMatches = new Set(manifest().content_scripts?.[0]?.matches ?? [])
  const files = contentScriptFiles()

  // Sites the static content script already covers must not get a second
  // copy injected; the static one asks shouldAutoEnable itself.
  const wanted = (await grantedAutoEnableSites()).filter(
    site => !staticMatches.has(site)
  )
  const wantedIds = new Set(wanted.map(site => SCRIPT_ID_PREFIX + site))

  const current = (await chrome.scripting.getRegisteredContentScripts()).filter(
    script => script.id.startsWith(SCRIPT_ID_PREFIX)
  )
  // An extension update renames the hashed bundle; a registration pointing at
  // the old file is as good as missing.
  const upToDate = (script: chrome.scripting.RegisteredContentScript) =>
    JSON.stringify(script.js ?? []) === JSON.stringify(files)

  const stale = current
    .filter(script => !wantedIds.has(script.id) || !upToDate(script))
    .map(script => script.id)
  const kept = new Set(
    current.filter(script => !stale.includes(script.id)).map(s => s.id)
  )
  const missing = wanted.filter(site => !kept.has(SCRIPT_ID_PREFIX + site))

  if (stale.length > 0) {
    await chrome.scripting.unregisterContentScripts({ ids: stale })
  }
  if (missing.length > 0 && files.length > 0) {
    await chrome.scripting.registerContentScripts(
      missing.map(site => ({
        id: SCRIPT_ID_PREFIX + site,
        matches: [site],
        js: files,
        runAt: 'document_end' as const,
        persistAcrossSessions: true,
      }))
    )
  }
}

export async function shouldAutoEnable(
  origin: string | undefined
): Promise<boolean> {
  const site = sitePatternFor(origin)
  if (!site) return false
  return (await grantedAutoEnableSites()).includes(site)
}
