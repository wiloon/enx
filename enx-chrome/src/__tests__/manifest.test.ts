import { readFileSync } from 'fs'
import { join } from 'path'

// ADR-019: the extension must run on enx-ui's own pages (so the Reader page
// gets the same click-to-lookup as any article site) AND accept the
// externally_connectable channel from those same origins -- kept in lockstep
// here so one can't be added without the other.
const ENX_UI_MATCH_PATTERNS = [
  'http://localhost:3000/*',
  'https://enx.wiloon.lab/*',
  'https://enx.wiloon.com/*',
]

const manifest = JSON.parse(
  readFileSync(join(__dirname, '../../manifest.json'), 'utf8')
)

describe('manifest.json enx-ui wiring (ADR-019)', () => {
  it('injects the content script on every enx-ui origin', () => {
    const matches: string[] = manifest.content_scripts[0].matches
    for (const pattern of ENX_UI_MATCH_PATTERNS) {
      expect(matches).toContain(pattern)
    }
  })

  it('opens externally_connectable to exactly the enx-ui origins', () => {
    const matches: string[] = manifest.externally_connectable.matches
    expect([...matches].sort()).toEqual([...ENX_UI_MATCH_PATTERNS].sort())
  })
})
