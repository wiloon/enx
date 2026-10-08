import { readFileSync } from 'fs'
import { join } from 'path'
import { buildManifest } from '../config/manifest'
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
  buildManifest(base, target, pkg.version) as unknown as StampedManifest

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
    expect(base.externally_connectable.matches).toEqual([])
  })

  // package.json is the one place the version is written; the Web Store and
  // Chrome's auto-update read the stamped manifest, the UI reads
  // __APP_VERSION__ (also from package.json), so the two can't drift.
  it.each(targetNames)('stamps the package.json version (%s)', name => {
    expect(stamp(TARGETS[name]).version).toBe(pkg.version)
  })

  it('keeps the version out of the static manifest', () => {
    expect(base).not.toHaveProperty('version')
  })

  // Chrome accepts 1-4 dot-separated integers, each 0-65535, no leading
  // zeros and no pre-release suffix such as "-beta".
  it('uses a version Chrome accepts', () => {
    expect(pkg.version).toMatch(/^(0|[1-9]\d{0,4})(\.(0|[1-9]\d{0,4})){0,3}$/)
    for (const part of pkg.version.split('.')) {
      expect(Number(part)).toBeLessThanOrEqual(65535)
    }
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
