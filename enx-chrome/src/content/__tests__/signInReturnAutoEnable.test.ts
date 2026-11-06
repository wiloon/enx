// #526 / adr-046 Decision 3 (sign-in return exception): back on the origin
// tab after an ADR-020 sign-in, auto-enable runs with the page-load policy
// but leaves no error badge. These tests load the real content script
// against a jsdom page and a fake background.

import { STAND_DOWN_EVENT } from '@/lib/orphanStandDown'
import type { SiteOrigins } from '@/lib/siteAdapters'
import { WORD_HIGHLIGHT_KEY } from '@/config/preferences'

jest.mock('@/config/env')

type Message = { type?: string; action?: string; status?: unknown }
type Callback = (response: unknown) => void

const ARTICLE_TEXT =
  'The quick brown fox jumps over the lazy dog while the patient reader ' +
  'keeps reading this paragraph about foxes, dogs and other animals.'
const LIVE_ID = 'abcdefghijklmnopqrstuvwxyzabcdef'

let sent: Message[]
let reviewList: () => unknown
let autoEnable: boolean

const LIST_OK = { success: true, reviewWords: [['fox', 1]] }
const LIST_FAILED = { success: false, error: 'Bad gateway' }
const LIST_EXPIRED = { success: false, sessionExpired: true }

const respond = (message: Message): unknown => {
  switch (message.type) {
    case 'getReviewWords':
      return reviewList()
    case 'shouldAutoEnable':
      return { success: true, autoEnable }
    default:
      return { success: true }
  }
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0))
const settle = async () => {
  for (let i = 0; i < 10; i++) await flush()
}
const spaSettle = async () => {
  await new Promise(resolve => setTimeout(resolve, 150)) // ready debounce
  await settle()
}

type Send = (request: unknown) => Promise<Record<string, unknown>>

const loadContentScript = async (
  origins: Partial<SiteOrigins> = {}
): Promise<Send> => {
  await jest.isolateModulesAsync(async () => {
    const { config } = await import('@/config/env')
    Object.assign(config, { rssxOrigins: [], ...origins })
    await import('../content')
  })
  const calls = (chrome.runtime.onMessage.addListener as jest.Mock).mock.calls
  const listener = calls[calls.length - 1][0] as (
    request: unknown,
    sender: unknown,
    sendResponse: (r: unknown) => void
  ) => unknown
  return request =>
    new Promise(resolve => {
      listener(request, {}, resolve as (r: unknown) => void)
    })
}

class FakeNavigation {
  listeners: ((event: NavigateEvent) => void)[] = []
  addEventListener(_type: 'navigate', l: (event: NavigateEvent) => void) {
    this.listeners.push(l)
  }
  removeEventListener(_type: 'navigate', l: (event: NavigateEvent) => void) {
    this.listeners = this.listeners.filter(x => x !== l)
  }
  navigate(url: string) {
    const event = {
      destination: { url },
      navigationType: 'push',
      hashChange: false,
      downloadRequest: null,
    } as unknown as NavigateEvent
    this.listeners.forEach(l => l(event))
  }
}

// The jsdom page is http://localhost/; as an RSSX origin it is an SPA site.
const SPA_ORIGINS = { rssxOrigins: ['http://localhost'] }

const loadSpaScript = async () => {
  const navigation = new FakeNavigation()
  ;(window as { navigation?: unknown }).navigation = navigation
  const send = await loadContentScript(SPA_ORIGINS)
  return { send, navigation }
}

const statuses = () =>
  sent.filter(m => m.type === 'learningModeStatus').map(m => m.status)
const errorStatuses = () =>
  statuses().filter(s => (s as { status: string }).status === 'error')
const listRequests = () => sent.filter(m => m.type === 'getReviewWords')
const finalStatus = async (send: Send) =>
  (await send({ action: 'getLearningModeStatus' })).status
const isEnabled = async (send: Send) =>
  (await send({ action: 'getPageInfo' })).isEnxEnabled

const signInReturn = (send: Send) =>
  send({ action: 'autoEnableOnSignInReturn' })

const popoverProto = HTMLElement.prototype as HTMLElement & {
  showPopover?: () => void
  hidePopover?: () => void
}
popoverProto.showPopover ??= () => {}
popoverProto.hidePopover ??= () => {}

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'debug').mockImplementation(() => {})
  sent = []
  autoEnable = false
  reviewList = () => LIST_OK
  ;(chrome.runtime as { id?: string }).id = LIVE_ID
  ;(chrome.runtime.sendMessage as jest.Mock).mockImplementation(
    (message: Message, callback?: Callback) => {
      sent.push(message)
      callback?.(respond(message))
    }
  )
  ;(chrome.runtime.getManifest as jest.Mock).mockReturnValue({
    version: '0.0.0-test',
  })
  ;(chrome.storage.local.get as jest.Mock).mockResolvedValue({})
  ;(chrome.storage.local.set as jest.Mock).mockResolvedValue(undefined)
  document.head.innerHTML = ''
  document.body.innerHTML = `<article><p>${ARTICLE_TEXT}</p></article>`
  delete (window as { navigation?: unknown }).navigation
})

afterEach(() => {
  // Every script loaded so far stands down, so none leaks into the next test.
  ;(chrome.runtime as { id?: string }).id = undefined
  document.dispatchEvent(new Event(STAND_DOWN_EVENT))
  ;(chrome.runtime as { id?: string }).id = LIVE_ID
  CSS.highlights.clear()
  jest.restoreAllMocks()
})

describe('auto-enable on a sign-in return', () => {
  it('turns learning mode on', async () => {
    const send = await loadContentScript()

    expect(await signInReturn(send)).toEqual({ success: true })
    await settle()

    expect(statuses()).toEqual([{ status: 'processing' }, { status: 'ready' }])
    expect(await isEnabled(send)).toBe(true)
  })

  it('clears the signed-out badge on a page the site adapter declares out of scope', async () => {
    // enx-ui outside /reader: the Reader adapter declares it out of scope.
    const send = await loadContentScript({ uiOrigins: ['http://localhost'] })

    await signInReturn(send)
    await settle()

    expect(statuses()).toEqual([{ status: 'off' }])
    expect(listRequests()).toHaveLength(0)
  })

  it.each([false, true])('rolls back a thrown error (SPA: %s)', async spa => {
    const navigation = new FakeNavigation()
    ;(window as { navigation?: unknown }).navigation = navigation
    const send = await loadContentScript(spa ? SPA_ORIGINS : {})
    if (spa) {
      const add = navigation.addEventListener.bind(navigation)
      jest
        .spyOn(navigation, 'addEventListener')
        .mockImplementation((type, listener) => {
          add(type, listener)
          throw new Error('navigation unavailable')
        })
    } else {
      const add = document.addEventListener.bind(document)
      jest.spyOn(document, 'addEventListener').mockImplementation(((
        type,
        listener,
        options
      ) => {
        add(type, listener, options)
        if (type === 'selectionchange') throw new Error('listener unavailable')
      }) as typeof document.addEventListener)
    }
    await signInReturn(send)
    if (spa) await spaSettle()
    else await settle()
    expect(await finalStatus(send)).toEqual({ status: 'off' })
    expect(await isEnabled(send)).toBe(false)
    expect(navigation.listeners).toHaveLength(0)
  })

  describe('on a static site', () => {
    it('does not roll back a newer run when an old account failure arrives', async () => {
      let finishOld: Callback = () => {}
      ;(chrome.runtime.sendMessage as jest.Mock).mockImplementation(
        (message: Message, callback?: Callback) => {
          sent.push(message)
          if (message.type === 'getReviewWords' && !finishOldCalled) {
            finishOldCalled = true
            finishOld = callback!
          } else callback?.(respond(message))
        }
      )
      let finishOldCalled = false
      const send = await loadContentScript()
      await signInReturn(send)
      await settle()
      expect(finishOldCalled).toBe(true)
      await send({ action: 'accountChanged' })
      await signInReturn(send)
      await settle()
      expect(await finalStatus(send)).toEqual({ status: 'ready' })
      finishOld({ success: false, accountDisabled: true })
      await settle()
      expect(await finalStatus(send)).toEqual({ status: 'ready' })
      expect(await isEnabled(send)).toBe(true)
    })

    it('rolls back to off after an actionable failure, with no error badge', async () => {
      reviewList = () => LIST_FAILED
      const send = await loadContentScript()

      await signInReturn(send)
      await settle()

      expect(errorStatuses()).toEqual([])
      expect(await finalStatus(send)).toEqual({ status: 'off' })
      expect(await isEnabled(send)).toBe(false)
    })
  })

  describe('on an SPA site', () => {
    it('ends at off after an actionable failure but keeps watching navigations', async () => {
      reviewList = () => LIST_FAILED
      const { send, navigation } = await loadSpaScript()

      await signInReturn(send)
      await spaSettle()

      expect(errorStatuses()).toEqual([])
      expect(await finalStatus(send)).toEqual({ status: 'off' })
      expect(await isEnabled(send)).toBe(true)
      expect(navigation.listeners).toHaveLength(1)

      reviewList = () => LIST_OK
      navigation.navigate('http://localhost/?article=2')
      await spaSettle()

      expect(await finalStatus(send)).toEqual({ status: 'ready' })
    })

    it('rolls back when the session expired', async () => {
      reviewList = () => LIST_EXPIRED
      const { send, navigation } = await loadSpaScript()

      await signInReturn(send)
      await spaSettle()

      expect(errorStatuses()).toEqual([])
      expect(await finalStatus(send)).toEqual({ status: 'off' })
      expect(await isEnabled(send)).toBe(false)
      expect(navigation.listeners).toHaveLength(0)
    })

    // The newer run (a navigation's rebuild) reports first; the return
    // attempt it superseded settles after it.
    it('a superseded attempt does not clear the newer run’s status', async () => {
      reviewList = () => LIST_FAILED
      const heldPreference: ((value: unknown) => void)[] = []
      ;(chrome.storage.local.get as jest.Mock).mockImplementation(
        async (key: unknown) =>
          key === WORD_HIGHLIGHT_KEY
            ? new Promise(resolve => heldPreference.push(resolve))
            : {}
      )
      const { send, navigation } = await loadSpaScript()
      await signInReturn(send)
      await spaSettle()
      expect(heldPreference).toHaveLength(1)

      navigation.navigate('http://localhost/?article=2')
      await spaSettle()
      expect(heldPreference).toHaveLength(2)
      heldPreference[1]({})
      await settle()
      heldPreference[0]({})
      await settle()

      expect(await finalStatus(send)).toEqual({
        status: 'error',
        reason: 'lookup-failed',
      })
    })
  })
})

// The sign-in return exception must not leak into the other enable paths.
describe('other enable paths keep their error badge', () => {
  it('page-load auto-enable on an SPA site ends at error and keeps watching', async () => {
    autoEnable = true
    reviewList = () => LIST_FAILED
    const { send, navigation } = await loadSpaScript()
    await spaSettle()

    expect(await finalStatus(send)).toEqual({
      status: 'error',
      reason: 'lookup-failed',
    })
    expect(await isEnabled(send)).toBe(true)
    expect(navigation.listeners).toHaveLength(1)
  })

  it('a manual enxRun on an SPA site ends at error', async () => {
    reviewList = () => LIST_FAILED
    const { send } = await loadSpaScript()

    expect(await send({ action: 'enxRun' })).toMatchObject({
      success: false,
      reason: 'lookup-failed',
    })
    expect(await finalStatus(send)).toEqual({
      status: 'error',
      reason: 'lookup-failed',
    })
  })
})
