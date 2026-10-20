import {
  sidebarVersionLines,
  uiBuildVersion,
  versionTitle,
} from '../buildVersion'

const ui = {
  version: 'v0.0.8',
  commit: 'aaaaaaa',
  build_time: '2026-10-20T06:00:00Z',
}
const api = { version: 'v0.0.8', commit: 'aaaaaaa', build_time: 'unknown' }

describe('uiBuildVersion', () => {
  it('reads the version the image was built with', () => {
    expect(
      uiBuildVersion({
        ENX_VERSION: 'v0.0.8',
        ENX_GIT_COMMIT: 'aaaaaaa',
        ENX_BUILD_TIME: '2026-10-20T06:00:00Z',
      })
    ).toEqual(ui)
  })

  it('is unknown when the image carries no version (dev server)', () => {
    expect(
      uiBuildVersion({
        ENX_VERSION: '',
        ENX_GIT_COMMIT: '',
        ENX_BUILD_TIME: '',
      })
    ).toBeNull()
  })

  it('marks a missing commit or build time as unknown', () => {
    expect(
      uiBuildVersion({
        ENX_VERSION: 'v0.0.8',
        ENX_GIT_COMMIT: '',
        ENX_BUILD_TIME: '',
      })
    ).toEqual({ version: 'v0.0.8', commit: 'unknown', build_time: 'unknown' })
  })
})

describe('versionTitle', () => {
  it('names the commit and, when known, the build time', () => {
    expect(versionTitle(ui)).toBe('commit aaaaaaa · built 2026-10-20T06:00:00Z')
    expect(versionTitle(api)).toBe('commit aaaaaaa')
  })
})

describe('sidebarVersionLines', () => {
  it("shows the UI's own version, alone when the API runs the same build", () => {
    expect(sidebarVersionLines('Catglish', ui, api)).toEqual([
      { label: 'Catglish v0.0.8', title: versionTitle(ui) },
    ])
  })

  it('flags the API version when it differs from the UI', () => {
    const older = { ...api, version: 'v0.0.7', commit: 'bbbbbbb' }
    expect(sidebarVersionLines('Catglish', ui, older)).toEqual([
      { label: 'Catglish v0.0.8', title: versionTitle(ui) },
      { label: 'API v0.0.7', title: versionTitle(older) },
    ])
  })

  it('flags the API when only the commit differs', () => {
    const branch = { ...ui, version: 'main' }
    const lines = sidebarVersionLines('Catglish', branch, {
      ...branch,
      commit: 'bbbbbbb',
    })
    expect(lines.map((l) => l.label)).toEqual(['Catglish main', 'API main'])
  })

  it('does not compare an unknown commit', () => {
    expect(
      sidebarVersionLines('Catglish', ui, { ...api, commit: 'unknown' })
    ).toHaveLength(1)
  })

  it("falls back to the API's version when the UI has none", () => {
    expect(sidebarVersionLines('Catglish', null, api)).toEqual([
      { label: 'Catglish v0.0.8', title: versionTitle(api) },
    ])
  })

  it('shows the UI version while the API version is unknown', () => {
    expect(sidebarVersionLines('Catglish', ui, null)).toEqual([
      { label: 'Catglish v0.0.8', title: versionTitle(ui) },
    ])
  })

  it('shows nothing when neither version is known', () => {
    expect(sidebarVersionLines('Catglish', null, null)).toEqual([])
  })
})
