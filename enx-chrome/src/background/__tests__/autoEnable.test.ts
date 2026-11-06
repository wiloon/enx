import {
  enableOnNewlyGrantedSite,
  enableOnSignInReturn,
  grantedAutoEnableSites,
  reconcileAutoEnableScripts,
  shouldAutoEnable,
} from '@/background/autoEnable'
import type { LearningModeStatus } from '@/lib/learningModeStatus'

const JS = ['assets/content.tsx-loader-abc.js']

const manifest = {
  host_permissions: ['https://api.catglish.com/*', 'https://catglish.com/*'],
  content_scripts: [
    { matches: ['https://x.com/*', 'https://catglish.com/*'], js: JS },
  ],
}

const permissions = chrome.permissions as unknown as {
  getAll: jest.Mock
}
const scripting = chrome.scripting as unknown as {
  registerContentScripts: jest.Mock
  unregisterContentScripts: jest.Mock
  getRegisteredContentScripts: jest.Mock
}

function granted(...origins: string[]) {
  permissions.getAll.mockResolvedValue({
    permissions: ['storage'],
    // Required host permissions show up in getAll() too.
    origins: [...manifest.host_permissions, ...origins],
  })
}

function registered(...scripts: { id: string; js?: string[] }[]) {
  scripting.getRegisteredContentScripts.mockResolvedValue(
    scripts.map(s => ({ js: JS, ...s }))
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(chrome.runtime.getManifest as jest.Mock).mockReturnValue(manifest)
  scripting.registerContentScripts.mockResolvedValue(undefined)
  scripting.unregisterContentScripts.mockResolvedValue(undefined)
  granted()
  registered()
})

describe('grantedAutoEnableSites', () => {
  it('lists user-granted exact origins, not the required host permissions', async () => {
    granted('https://www.infoq.com/*')
    expect(await grantedAutoEnableSites()).toEqual(['https://www.infoq.com/*'])
  })

  it('ignores a wildcard grant from Chrome site access', async () => {
    granted('https://*/*', 'https://www.infoq.com/*')
    expect(await grantedAutoEnableSites()).toEqual(['https://www.infoq.com/*'])
  })
})

describe('reconcileAutoEnableScripts (adr-039 Decision 3)', () => {
  it('registers a script for a newly granted site', async () => {
    granted('https://www.infoq.com/*')

    await reconcileAutoEnableScripts()

    expect(scripting.registerContentScripts).toHaveBeenCalledWith([
      {
        id: 'auto-enable:https://www.infoq.com/*',
        matches: ['https://www.infoq.com/*'],
        js: JS,
        runAt: 'document_end',
        persistAcrossSessions: true,
      },
    ])
    expect(scripting.unregisterContentScripts).not.toHaveBeenCalled()
  })

  it('unregisters the script of a site whose permission was revoked', async () => {
    registered({ id: 'auto-enable:https://www.infoq.com/*' })

    await reconcileAutoEnableScripts()

    expect(scripting.unregisterContentScripts).toHaveBeenCalledWith({
      ids: ['auto-enable:https://www.infoq.com/*'],
    })
    expect(scripting.registerContentScripts).not.toHaveBeenCalled()
  })

  // The static content script already runs there; a second registration
  // would inject the bundle twice.
  it('does not register a site the static content script already covers', async () => {
    granted('https://x.com/*')

    await reconcileAutoEnableScripts()

    expect(scripting.registerContentScripts).not.toHaveBeenCalled()
  })

  it('is a no-op when registrations already match the grants', async () => {
    granted('https://www.infoq.com/*')
    registered({ id: 'auto-enable:https://www.infoq.com/*' })

    await reconcileAutoEnableScripts()

    expect(scripting.registerContentScripts).not.toHaveBeenCalled()
    expect(scripting.unregisterContentScripts).not.toHaveBeenCalled()
  })

  // An extension update renames the hashed bundle; a registration still
  // pointing at the old file would inject nothing.
  it('re-registers a script whose files are stale after an update', async () => {
    granted('https://www.infoq.com/*')
    registered({
      id: 'auto-enable:https://www.infoq.com/*',
      js: ['assets/content.tsx-loader-OLD.js'],
    })

    await reconcileAutoEnableScripts()

    expect(scripting.unregisterContentScripts).toHaveBeenCalledWith({
      ids: ['auto-enable:https://www.infoq.com/*'],
    })
    expect(scripting.registerContentScripts).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'auto-enable:https://www.infoq.com/*',
        js: JS,
      }),
    ])
  })

  it('leaves scripts it did not register alone', async () => {
    registered({ id: 'something-else' })

    await reconcileAutoEnableScripts()

    expect(scripting.unregisterContentScripts).not.toHaveBeenCalled()
  })
})

describe('shouldAutoEnable (adr-039 Decision 4)', () => {
  it('is true for a granted site', async () => {
    granted('https://www.infoq.com/*')
    expect(await shouldAutoEnable('https://www.infoq.com')).toBe(true)
  })

  it('is false for a site that was never granted', async () => {
    expect(await shouldAutoEnable('https://www.infoq.com')).toBe(false)
  })

  it('is false for a required host (enx-ui / api)', async () => {
    expect(await shouldAutoEnable('https://catglish.com')).toBe(false)
  })

  it('is true for a granted statically injected site', async () => {
    granted('https://x.com/*')
    expect(await shouldAutoEnable('https://x.com')).toBe(true)
  })

  it('is false when every site was granted via a wildcard', async () => {
    granted('https://*/*')
    expect(await shouldAutoEnable('https://www.infoq.com')).toBe(false)
  })

  it('is false for a missing origin', async () => {
    granted('https://www.infoq.com/*')
    expect(await shouldAutoEnable(undefined)).toBe(false)
  })
})

// The popup closes under Chrome's permission dialog, so without this the user
// had to reopen it just to press "Read with Catglish" on the page in front of
// them.
describe('enableOnNewlyGrantedSite', () => {
  const tabs = chrome.tabs as unknown as { query: jest.Mock }

  function deps(
    overrides: Partial<Parameters<typeof enableOnNewlyGrantedSite>[1]> = {}
  ) {
    return {
      isSignedIn: jest.fn().mockResolvedValue(true),
      getStatus: jest.fn().mockResolvedValue({ status: 'off' }),
      enable: jest.fn().mockResolvedValue({ success: true }),
      ...overrides,
    }
  }

  it('turns learning mode on in the active tab of the site just granted', async () => {
    tabs.query.mockResolvedValue([
      { id: 7, url: 'https://www.infoq.com/articles/foo' },
    ])
    const d = deps()

    await enableOnNewlyGrantedSite({ origins: ['https://www.infoq.com/*'] }, d)

    expect(d.enable).toHaveBeenCalledWith(7)
  })

  it('leaves a page that is already on alone', async () => {
    tabs.query.mockResolvedValue([
      { id: 7, url: 'https://www.infoq.com/articles/foo' },
    ])
    const d = deps({
      getStatus: jest.fn().mockResolvedValue({ status: 'ready' }),
    })

    await enableOnNewlyGrantedSite({ origins: ['https://www.infoq.com/*'] }, d)

    expect(d.enable).not.toHaveBeenCalled()
  })

  it('does nothing while signed out', async () => {
    tabs.query.mockResolvedValue([
      { id: 7, url: 'https://www.infoq.com/articles/foo' },
    ])
    const d = deps({ isSignedIn: jest.fn().mockResolvedValue(false) })

    await enableOnNewlyGrantedSite({ origins: ['https://www.infoq.com/*'] }, d)

    expect(d.enable).not.toHaveBeenCalled()
  })

  it('skips active tabs on other sites', async () => {
    tabs.query.mockResolvedValue([
      { id: 7, url: 'https://www.infoq.com/articles/foo' },
      { id: 8, url: 'https://example.com/' },
    ])
    const d = deps()

    await enableOnNewlyGrantedSite({ origins: ['https://www.infoq.com/*'] }, d)

    expect(d.enable).toHaveBeenCalledTimes(1)
    expect(d.enable).toHaveBeenCalledWith(7)
  })

  it('ignores a grant that is not a single site', async () => {
    tabs.query.mockResolvedValue([{ id: 7, url: 'https://www.infoq.com/' }])
    const d = deps()

    await enableOnNewlyGrantedSite({ origins: ['https://*/*'] }, d)

    expect(d.enable).not.toHaveBeenCalled()
  })
})

// #526: the origin tab is only refocused, never reloaded, so page-load
// auto-enable does not run again after an ADR-020 sign-in return.
describe('enableOnSignInReturn', () => {
  const tabs = chrome.tabs as unknown as { get: jest.Mock }

  function deps(status: LearningModeStatus = { status: 'off' }) {
    return {
      getStatus: jest.fn().mockResolvedValue(status),
      enable: jest.fn().mockResolvedValue(undefined),
    }
  }

  beforeEach(() => {
    granted('https://www.infoq.com/*')
    tabs.get.mockResolvedValue({
      id: 42,
      url: 'https://www.infoq.com/articles/foo',
    })
  })

  it.each<[string, LearningModeStatus]>([
    ['off', { status: 'off' }],
    ['error: session-expired', { status: 'error', reason: 'session-expired' }],
    ['error: signed-out', { status: 'error', reason: 'signed-out' }],
  ])('enables the origin tab of an auto-enabled site at %s', async (_, s) => {
    const d = deps(s)

    await enableOnSignInReturn(42, d)

    expect(d.enable).toHaveBeenCalledWith(42)
  })

  it.each<[string, LearningModeStatus]>([
    ['processing', { status: 'processing' }],
    ['ready', { status: 'ready' }],
    ['error: lookup-failed', { status: 'error', reason: 'lookup-failed' }],
  ])('leaves the origin tab alone at %s', async (_, s) => {
    const d = deps(s)

    await enableOnSignInReturn(42, d)

    expect(d.enable).not.toHaveBeenCalled()
  })

  it('leaves a tab on a site that was not granted alone', async () => {
    tabs.get.mockResolvedValue({ id: 42, url: 'https://example.com/a' })
    const d = deps()

    await enableOnSignInReturn(42, d)

    expect(d.enable).not.toHaveBeenCalled()
  })

  it('does nothing, quietly, when the origin tab was closed', async () => {
    tabs.get.mockRejectedValue(new Error('No tab with id: 42'))
    const d = deps()

    await expect(enableOnSignInReturn(42, d)).resolves.toBeUndefined()

    expect(d.getStatus).not.toHaveBeenCalled()
    expect(d.enable).not.toHaveBeenCalled()
  })
})
