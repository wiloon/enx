import {
  grantedAutoEnableSites,
  reconcileAutoEnableScripts,
  shouldAutoEnable,
} from '@/background/autoEnable'

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
