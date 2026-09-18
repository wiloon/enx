import { readFileSync } from 'fs'
import { join } from 'path'
import { buildManifest } from '../config/manifest'
import { TARGETS, type TargetName } from '../config/targets'

const base = JSON.parse(
  readFileSync(join(__dirname, '../../manifest.json'), 'utf8')
)

describe('manifest stamping (ADR-019)', () => {
  const targetNames: TargetName[] = ['development', 'homelab', 'production']

  // The extension must run on enx-ui's own pages (so the Reader page gets the
  // same click-to-lookup as any article site) AND accept the
  // externally_connectable channel from those same origins -- both are derived
  // from the target's uiOrigins so one can't be added without the other.
  it.each(targetNames)('wires %s enx-ui origins into both places', name => {
    const target = TARGETS[name]
    const manifest = buildManifest(base, target)
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
    const manifest = buildManifest(base, TARGETS.production)
    const origins = [
      ...manifest.externally_connectable.matches,
      ...manifest.content_scripts[0].matches,
    ]

    expect(origins).not.toContain('https://enx.wiloon.lab/*')
    expect(origins).not.toContain('http://localhost:3000/*')
    expect(manifest.host_permissions).toContain('https://enx-api.wiloon.com/*')
  })

  it('derives the Clerk host permission from the publishable key', () => {
    const manifest = buildManifest(base, TARGETS.homelab)
    expect(manifest.host_permissions).toContain(
      'https://rational-deer-4450.clerk.accounts.dev/*'
    )
  })

  it('marks non-production builds in the extension name', () => {
    expect(buildManifest(base, TARGETS.production).name).toBe(base.name)
    expect(buildManifest(base, TARGETS.homelab).name).toBe(`${base.name} (Lab)`)
    expect(buildManifest(base, TARGETS.development).name).toBe(
      `${base.name} (Dev)`
    )
  })

  it('leaves the static manifest free of deployment-specific origins', () => {
    const serialized = JSON.stringify(base)
    expect(serialized).not.toContain('enx.wiloon.lab')
    expect(serialized).not.toContain('enx-api.wiloon')
    expect(base.externally_connectable.matches).toEqual([])
  })
})
