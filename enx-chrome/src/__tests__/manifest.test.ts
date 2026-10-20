import { readFileSync } from 'fs'
import { join } from 'path'
import { buildManifest } from '../config/manifest'
import { TOGGLE_LEARNING_MODE_COMMAND } from '../lib/learningModeCommand'
import {
  clerkFrontendApiHost,
  TARGETS,
  type Target,
  type TargetName,
} from '../config/targets'

const base = JSON.parse(
  readFileSync(join(__dirname, '../../manifest.json'), 'utf8')
)
const pkg = JSON.parse(
  readFileSync(join(__dirname, '../../package.json'), 'utf8')
)

const VERSION = '0.1.2'

// buildManifest returns an open-ended Manifest (most keys are `unknown`); these
// are the fields this file reads, all present in manifest.json.
interface StampedManifest {
  name: string
  version: string
  host_permissions: string[]
  content_scripts: { matches: string[] }[]
  externally_connectable: { matches: string[] }
  web_accessible_resources: { matches: string[]; resources: string[] }[]
}

const stamp = (target: Target): StampedManifest =>
  buildManifest(base, target, VERSION) as unknown as StampedManifest

describe('manifest stamping (ADR-019)', () => {
  const targetNames: TargetName[] = ['development', 'homelab', 'production']

  // The extension must run on enx-ui's own pages (so the Reader page gets the
  // same click-to-lookup as any article site) AND accept the
  // externally_connectable channel from those same origins -- both are derived
  // from the target's uiOrigins so one can't be added without the other.
  it.each(targetNames)('wires %s enx-ui origins into both places', name => {
    const target = TARGETS[name]
    const manifest = stamp(target)
    const expected = target.uiOrigins.map(origin => `${origin}/*`)

    expect([...manifest.externally_connectable.matches].sort()).toEqual(
      [...expected].sort()
    )
    for (const pattern of expected) {
      expect(manifest.content_scripts[0].matches).toContain(pattern)
      expect(manifest.host_permissions).toContain(pattern)
    }
  })

  it('keeps the production build off homelab and localhost origins', () => {
    const manifest = stamp(TARGETS.production)
    const origins = [
      ...manifest.externally_connectable.matches,
      ...manifest.content_scripts[0].matches,
    ]

    expect(origins).not.toContain('https://enx.wiloon.lab/*')
    expect(origins).not.toContain('http://localhost:3000/*')
    expect(manifest.host_permissions).toContain('https://api.catglish.com/*')
    // The website origin must be both reachable (host permission, for the
    // Clerk session sync) and the ONLY UI origin wired to the web -> extension
    // channel, otherwise a stale domain silently keeps the old site trusted.
    expect(manifest.host_permissions).toContain('https://catglish.com/*')
    expect(manifest.externally_connectable.matches).toEqual([
      'https://catglish.com/*',
    ])
  })

  // A production Clerk instance keeps the `__client` cookie on its Frontend
  // API host (Domain=clerk.catglish.com), not on the website, and
  // @clerk/chrome-extension reads that cookie at `syncHost`. Pointing syncHost
  // at catglish.com makes the extension look signed out forever.
  it('syncs the production Clerk session from the Frontend API host', () => {
    const key = 'pk_live_Y2xlcmsuY2F0Z2xpc2guY29tJA' // .env.production
    expect(TARGETS.production.clerkSyncHost).toBe(
      `https://${clerkFrontendApiHost(key)}`
    )
    expect(
      stamp({ ...TARGETS.production, clerkPublishableKey: key })
        .host_permissions
    ).toContain('https://clerk.catglish.com/*')
  })

  it('derives the Clerk host permission from the publishable key', () => {
    const manifest = stamp(TARGETS.homelab)
    expect(manifest.host_permissions).toContain(
      'https://rational-deer-4450.clerk.accounts.dev/*'
    )
  })

  it('marks non-production builds in the extension name', () => {
    expect(stamp(TARGETS.production).name).toBe(base.name)
    expect(stamp(TARGETS.homelab).name).toBe(`${base.name} (Lab)`)
    expect(stamp(TARGETS.development).name).toBe(`${base.name} (Dev)`)
  })

  // adr-034: on-demand injection (chrome.scripting.executeScript) can target
  // any page, but CRXJS scopes the content-script loader's dynamically
  // imported chunk to content_scripts[0].matches by default -- which is now
  // only X/RSSX/enx-ui. Without a broader web_accessible_resources entry,
  // injecting on any other site fails with "Resources must be listed in the
  // web_accessible_resources manifest key" (reproduced on a live InfoQ page).
  it('keeps built JS assets web-accessible from any page, not just the declarative whitelist', () => {
    const manifest = stamp(TARGETS.production)
    const broadEntry = manifest.web_accessible_resources.find(
      entry =>
        entry.matches.includes('http://*/*') &&
        entry.matches.includes('https://*/*')
    )
    expect(broadEntry).toBeDefined()
    expect(broadEntry?.resources).toContain('assets/*')
  })

  // adr-039: per-site auto-enable asks for one exact origin at a time at
  // runtime; the ceiling is declared optional so installing shows no
  // "all sites" warning, and the static host_permissions stays empty.
  it.each(targetNames)(
    'declares optional host permissions for per-site auto-enable (%s)',
    name => {
      const manifest = stamp(TARGETS[name]) as unknown as {
        optional_host_permissions: string[]
      }
      expect(manifest.optional_host_permissions).toEqual([
        'https://*/*',
        'http://*/*',
      ])
    }
  )

  it('keeps the static host_permissions empty', () => {
    expect(base.host_permissions).toEqual([])
  })

  it('leaves the static manifest free of deployment-specific origins', () => {
    const serialized = JSON.stringify(base)
    expect(serialized).not.toContain('enx.wiloon.lab')
    expect(serialized).not.toContain('enx-api.wiloon')
    expect(serialized).not.toContain('rssx-lab.wiloon.com')
    expect(base.externally_connectable.matches).toEqual([])
  })

  // ADR-033: rssx-lab.wiloon.com resolves to a LAN address, so only the
  // homelab and dev builds may auto-inject there. In the store build it would
  // only add a private domain to the install-time permission warning.
  it.each(['development', 'homelab'] as TargetName[])(
    'auto-injects on the RSSX reader in the %s build',
    name => {
      expect(stamp(TARGETS[name]).content_scripts[0].matches).toContain(
        'https://rssx-lab.wiloon.com/*'
      )
    }
  )

  // X gets no static content script: it would put x.com and twitter.com in
  // the install-time permission warning. Like any other site it is turned on
  // from the popup (activeTab) or by "Always enable on this site" (adr-039).
  it.each(targetNames)('does not auto-inject on X in the %s build', name => {
    const manifest = stamp(TARGETS[name])
    const patterns = [
      ...manifest.content_scripts.flatMap(script => script.matches),
      ...manifest.host_permissions,
    ]
    expect(patterns).not.toContain('https://x.com/*')
    expect(patterns).not.toContain('https://twitter.com/*')
  })

  it('keeps the RSSX reader out of the production build', () => {
    expect(JSON.stringify(stamp(TARGETS.production))).not.toContain(
      'rssx-lab.wiloon.com'
    )
  })

  // The version comes from chrome-v* git tags (ADR-031 §6a, version.ts); the
  // Web Store and Chrome's auto-update read the stamped manifest, the UI
  // reads __APP_VERSION__ from the same value, so the two can't drift.
  it.each(targetNames)('stamps the version it is given (%s)', name => {
    expect(stamp(TARGETS[name]).version).toBe(VERSION)
  })

  it('keeps the version out of the static manifest', () => {
    expect(base).not.toHaveProperty('version')
  })

  // A version written back into package.json would look authoritative and
  // silently disagree with the tag.
  it('keeps the version out of package.json', () => {
    expect(pkg).not.toHaveProperty('version')
  })

  // #230: Alt+C toggles learning mode with the popup closed. The command's
  // name is what background.ts listens for, so it comes from the same
  // constant. Opening the popup keeps its own shortcut.
  it('suggests Alt+C for the learning mode toggle and keeps the popup shortcut', () => {
    expect(base.commands[TOGGLE_LEARNING_MODE_COMMAND]).toEqual({
      suggested_key: { default: 'Alt+C', mac: 'Alt+C' },
      description: 'Turn Catglish on or off on this page',
    })
    expect(base.commands._execute_action.suggested_key).toEqual({
      default: 'Ctrl+Shift+E',
      mac: 'Command+Shift+E',
    })
  })

  // Every permission is justified one by one on the Web Store's Privacy tab,
  // and an unused one is a common rejection reason. Adding one is a review
  // decision, not a drive-by: update this list and the store justification
  // together. (`identity` was the Cognito-era launchWebAuthFlow; Clerk signs
  // in through the website and needs `cookies` instead.)
  it('requests exactly the permissions the Web Store listing justifies', () => {
    expect([...base.permissions].sort()).toEqual(
      [
        'activeTab',
        'contextMenus',
        'cookies',
        'notifications',
        'scripting',
        'sidePanel',
        'storage',
      ].sort()
    )
  })
})
