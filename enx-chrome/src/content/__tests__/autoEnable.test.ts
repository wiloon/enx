import { maybeAutoEnable } from '@/content/autoEnable'
import { ENABLE_OK, failed } from '@/lib/enableOutcome'

function deps(overrides: Partial<Parameters<typeof maybeAutoEnable>[0]> = {}) {
  return {
    askBackground: jest.fn(async () => true),
    isPageSupported: jest.fn(() => true),
    enable: jest.fn(async () => ENABLE_OK),
    disable: jest.fn(),
    keepsWatching: jest.fn(() => false),
    ...overrides,
  }
}

describe('maybeAutoEnable (adr-039 Decision 4)', () => {
  it('enables learning mode on a granted site', async () => {
    const d = deps()
    await maybeAutoEnable(d)
    expect(d.enable).toHaveBeenCalledTimes(1)
    expect(d.disable).not.toHaveBeenCalled()
  })

  it('does nothing when the site is not granted', async () => {
    const d = deps({ askBackground: jest.fn(async () => false) })
    await maybeAutoEnable(d)
    expect(d.enable).not.toHaveBeenCalled()
  })

  it('does nothing when the background cannot be reached', async () => {
    const d = deps({
      askBackground: jest.fn(async () => {
        throw new Error('Could not establish connection')
      }),
    })
    await expect(maybeAutoEnable(d)).resolves.toBeUndefined()
    expect(d.enable).not.toHaveBeenCalled()
  })

  // e.g. an X timeline page: the manual path would show the adapter's
  // "not supported" message; auto-enable stays quiet.
  it('does nothing on a page the site adapter declares out of scope', async () => {
    const d = deps({ isPageSupported: jest.fn(() => false) })
    await maybeAutoEnable(d)
    expect(d.enable).not.toHaveBeenCalled()
  })

  // A home or list page on the same origin has no article: leave the page as
  // it was (no selection-translate listeners left behind), with no UI.
  it('rolls back silently when no article is found', async () => {
    const d = deps({ enable: jest.fn(async () => failed('no-article-node')) })
    await expect(maybeAutoEnable(d)).resolves.toBeUndefined()
    expect(d.disable).toHaveBeenCalledTimes(1)
  })

  it('rolls back silently when enabling throws', async () => {
    const d = deps({
      enable: jest.fn(async () => {
        throw new Error('boom')
      }),
    })
    await expect(maybeAutoEnable(d)).resolves.toBeUndefined()
    expect(d.disable).toHaveBeenCalledTimes(1)
  })

  // adr-033: on an SPA site (RSSX) the first page load often has no article
  // open yet. Rolling back would also stop the navigation listener, so the
  // article the user opens next would never be processed.
  describe('on an SPA site that keeps watching navigations', () => {
    it.each(['no-article-node', 'no-words', 'lookup-failed', 'error'] as const)(
      'stays enabled after %s',
      async reason => {
        const d = deps({
          enable: jest.fn(async () => failed(reason)),
          keepsWatching: jest.fn(() => true),
        })
        await maybeAutoEnable(d)
        expect(d.disable).not.toHaveBeenCalled()
      }
    )

    // Signed out: every later article would fail the same way.
    it('still rolls back when the session expired', async () => {
      const d = deps({
        enable: jest.fn(async () => failed('session-expired')),
        keepsWatching: jest.fn(() => true),
      })
      await maybeAutoEnable(d)
      expect(d.disable).toHaveBeenCalledTimes(1)
    })
  })
})
