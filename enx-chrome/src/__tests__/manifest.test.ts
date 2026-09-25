import { readFileSync } from 'fs'
import { join } from 'path'
import { buildManifest } from '../config/manifest'
import { TARGETS, type Target, type TargetName } from '../config/targets'

const base = JSON.parse(
  readFileSync(join(__dirname, '../../manifest.json'), 'utf8')
)

// buildManifest returns an open-ended Manifest (most keys are `unknown`); these
// are the fields this file reads, all present in manifest.json.
interface StampedManifest {
  name: string
  host_permissions: string[]
  content_scripts: { matches: string[] }[]
  externally_connectable: { matches: string[] }
  web_accessible_resources: { matches: string[]; resources: string[] }[]
}

const stamp = (target: Target): StampedManifest =>
  buildManifest(base, target) as unknown as StampedManifest

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

  it('leaves the static manifest free of deployment-specific origins', () => {
    const serialized = JSON.stringify(base)
    expect(serialized).not.toContain('enx.wiloon.lab')
    expect(serialized).not.toContain('enx-api.wiloon')
    expect(base.externally_connectable.matches).toEqual([])
  })
})
