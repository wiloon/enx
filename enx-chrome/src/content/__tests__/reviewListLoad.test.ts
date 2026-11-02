// ADR-069 Decision 1: learning mode underlines from the user's review list,
// loaded once per page with no page text. These tests load the real content
// script against a jsdom page and a fake background.

import { STAND_DOWN_EVENT } from '@/lib/orphanStandDown'
import type { SiteOrigins } from '@/lib/siteAdapters'
import { WORD_HIGHLIGHT_KEY } from '@/config/preferences'
import {
  intersectionObservers,
  liveIntersectionObservers,
  showAllObserved,
} from '@/test/fakeIntersectionObserver'

jest.mock('@/config/env')

type Message = { type?: string; action?: string }
type Callback = (response: unknown) => void

const ARTICLE_TEXT =
  "The Fox and the fox’s den and FOX'S tail, while the lazy dog sleeps " +
  'and the patient reader keeps reading this paragraph about animals.'
const LIVE_ID = 'abcdefghijklmnopqrstuvwxyzabcdef'

const FOX = {
  Id: 'w-fox',
  Key: 'fox',
  English: 'fox',
  Chinese: '狐狸',
  Pronunciation: '',
  LoadCount: 1,
  Known: false,
  WordType: 0,
}

let sent: Message[]
let reviewList: () => unknown
let lookup: () => unknown
let holdList: boolean
let heldList: Callback[]

const respond = (message: Message): unknown => {
  switch (message.type) {
    case 'getReviewWords':
      return reviewList()
    case 'getOneWord':
      return lookup()
    case 'shouldAutoEnable':
      return { success: true, autoEnable: false }
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

const releaseList = async () => {
  const pending = heldList
  heldList = []
  pending.forEach(callback => callback(respond({ type: 'getReviewWords' })))
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

const listRequests = () => sent.filter(m => m.type === 'getReviewWords')

// Flips the "highlight vocabulary while reading" preference through the
// content script's storage listener.
const setHighlightPreference = (enabled: boolean) => {
  const calls = (chrome.storage.onChanged.addListener as jest.Mock).mock.calls
  const listener = calls[calls.length - 1][0]
  listener({ [WORD_HIGHLIGHT_KEY]: { newValue: enabled } }, 'local')
}

// Every underlined word, by highlight name.
const underlined = (): Record<string, string[]> => {
  const out: Record<string, string[]> = {}
  for (const [name, highlight] of CSS.highlights) {
    if (!name.startsWith('enx-hl-')) continue
    out[name] = [...(highlight as unknown as Iterable<Range>)].map(r =>
      r.toString()
    )
  }
  return out
}

const paragraph = () => document.querySelector('article p')!
const overlays = () => document.querySelectorAll('#enx-anchored-overlay')

// jsdom has no layout: resolve every click to "fox" and give every Range a
// box that contains the click.
const clickFox = async () => {
  const text = paragraph().firstChild!
  const offset = text.textContent!.indexOf('fox') + 1
  ;(
    document as unknown as {
      caretPositionFromPoint: (x: number, y: number) => unknown
    }
  ).caretPositionFromPoint = () => ({ offsetNode: text, offset })
  paragraph().dispatchEvent(
    new MouseEvent('click', { bubbles: true, clientX: 5, clientY: 5 })
  )
  await settle()
}

const markKnownInPopover = async () => {
  const button = overlays()[0].shadowRoot!.querySelector(
    '[data-testid="word-popover-mark-known"]'
  ) as HTMLButtonElement
  button.click()
  await settle()
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

const popoverProto = HTMLElement.prototype as HTMLElement & {
  showPopover?: () => void
  hidePopover?: () => void
}
popoverProto.showPopover ??= () => {}
popoverProto.hidePopover ??= () => {}

const BOX = {
  left: 0,
  top: 0,
  right: 1000,
  bottom: 1000,
  width: 1000,
  height: 1000,
  x: 0,
  y: 0,
}

beforeAll(() => {
  Range.prototype.getClientRects = () => [BOX] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => BOX as DOMRect
})

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'debug').mockImplementation(() => {})
  sent = []
  heldList = []
  holdList = false
  reviewList = () => ({ success: true, reviewWords: [['fox', 1]] })
  lookup = () => ({ success: true, ecp: FOX })
  ;(chrome.runtime as { id?: string }).id = LIVE_ID
  ;(chrome.runtime.sendMessage as jest.Mock).mockImplementation(
    (message: Message, callback?: Callback) => {
      sent.push(message)
      if (!callback) return
      if (message.type === 'getReviewWords' && holdList) heldList.push(callback)
      else callback(respond(message))
    }
  )
  ;(chrome.storage.local.get as jest.Mock).mockResolvedValue({})
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

describe('enabling learning mode', () => {
  it('sends one review-list request with no page text, and no paragraph-init', async () => {
    const send = await loadContentScript()

    expect(await send({ action: 'enxRun' })).toMatchObject({ success: true })

    expect(listRequests()).toEqual([{ type: 'getReviewWords' }])
    expect(sent.filter(m => m.type === 'getWords')).toEqual([])
    expect(JSON.stringify(sent)).not.toMatch(/lazy|patient|paragraph/)
  })

  it('succeeds with an empty list, and a word click still looks it up', async () => {
    reviewList = () => ({ success: true, reviewWords: [] })
    const send = await loadContentScript()

    expect(await send({ action: 'enxRun' })).toMatchObject({ success: true })
    showAllObserved()
    expect(underlined()).toEqual({})

    await clickFox()
    expect(overlays()).toHaveLength(1)
    expect(sent.filter(m => m.type === 'getOneWord')).toHaveLength(1)
  })

  it('underlines a list word in any case and as a possessive, and nothing else', async () => {
    const send = await loadContentScript()
    await send({ action: 'enxRun' })
    showAllObserved()

    expect(underlined()).toEqual({ 'enx-hl-1': ['Fox', 'fox’s', "FOX'S"] })
  })

  it.each([
    ['a rejected request', { success: false, error: 'boom' }, 'lookup-failed'],
    [
      'a malformed list',
      { success: true, reviewWords: { fox: 1 } },
      'lookup-failed',
    ],
    [
      'the rate limit',
      {
        success: false,
        status: 429,
        code: 'too_many_requests',
        retryAfterMs: 1,
      },
      'rate-limited',
    ],
    [
      'a disabled account',
      { success: false, status: 403, code: 'account_disabled' },
      'account-disabled',
    ],
  ])('reports %s as its failure', async (_name, reply, reason) => {
    jest.useFakeTimers({
      doNotFake: ['setTimeout', 'nextTick', 'setImmediate'],
    })
    reviewList = () => reply
    const send = await loadContentScript()

    expect(await send({ action: 'enxRun' })).toMatchObject({
      success: false,
      reason,
    })
    jest.useRealTimers()
  })
})

describe('reusing the list', () => {
  it('turning learning mode off and on, or enabling again, sends no new request', async () => {
    const send = await loadContentScript()
    await send({ action: 'enxRun' })
    await send({ action: 'enxStop' })
    await send({ action: 'enxRun' })
    await send({ action: 'enxRun' })
    showAllObserved()

    expect(listRequests()).toHaveLength(1)
    expect(underlined()).toEqual({ 'enx-hl-1': ['Fox', 'fox’s', "FOX'S"] })
  })

  it('an SPA switch after a successful load paints without another request', async () => {
    const { send, navigation } = await loadSpaScript()
    await send({ action: 'enxRun' })
    CSS.highlights.clear()

    navigation.navigate('http://localhost/?article=2')
    await spaSettle()
    showAllObserved()

    expect(listRequests()).toHaveLength(1)
    expect(underlined()).toEqual({ 'enx-hl-1': ['Fox', 'fox’s', "FOX'S"] })
  })

  it('an SPA switch during the load uses that load', async () => {
    holdList = true
    const { send, navigation } = await loadSpaScript()
    const run = send({ action: 'enxRun' })
    await spaSettle()

    navigation.navigate('http://localhost/?article=2')
    await spaSettle()
    await releaseList()
    await run
    await spaSettle()
    showAllObserved()

    expect(listRequests()).toHaveLength(1)
    expect(underlined()).toEqual({ 'enx-hl-1': ['Fox', 'fox’s', "FOX'S"] })
  })

  it('enabling again during the load shares it, and only the newer run paints', async () => {
    holdList = true
    const { send } = await loadSpaScript()
    const run = send({ action: 'enxRun' })
    await spaSettle()
    const rerun = send({ action: 'enxRun' })
    await spaSettle()
    const set = jest.spyOn(CSS.highlights, 'set')

    await releaseList()

    expect(await run).toMatchObject({ success: true })
    expect(await rerun).toMatchObject({ success: true })
    showAllObserved()
    expect(listRequests()).toHaveLength(1)
    expect(set).toHaveBeenCalledTimes(1)
  })

  it('a lookup made during the load wins over the list', async () => {
    holdList = true
    const send = await loadContentScript()
    const run = send({ action: 'enxRun' })
    await settle()

    await send({
      action: 'panelWordLookup',
      word: 'fox',
      ecp: { ...FOX, LoadCount: 9 },
    })
    await releaseList()
    await run
    showAllObserved()

    expect(underlined()).toEqual({ 'enx-hl-3': ['Fox', 'fox’s', "FOX'S"] })
  })
})

describe('a failed load', () => {
  it('is retried by the next enable, even with words already cached', async () => {
    const send = await loadContentScript()
    await send({ action: 'panelWordLookup', word: 'dog', ecp: FOX })
    reviewList = () => ({ success: false, error: 'boom' })

    expect(await send({ action: 'enxRun' })).toMatchObject({
      success: false,
      reason: 'lookup-failed',
    })
    expect(listRequests()).toHaveLength(2) // the request and its one retry

    reviewList = () => ({ success: true, reviewWords: [['fox', 1]] })
    expect(await send({ action: 'enxRun' })).toMatchObject({ success: true })
    expect(listRequests()).toHaveLength(3)
  })

  it('is retried by the next SPA rebuild', async () => {
    reviewList = () => ({ success: false, error: 'boom' })
    const { send, navigation } = await loadSpaScript()
    await send({ action: 'enxRun' })
    expect(listRequests()).toHaveLength(2)

    reviewList = () => ({ success: true, reviewWords: [['fox', 1]] })
    navigation.navigate('http://localhost/?article=2')
    await spaSettle()
    showAllObserved()

    expect(listRequests()).toHaveLength(3)
    expect(underlined()).toEqual({ 'enx-hl-1': ['Fox', 'fox’s', "FOX'S"] })
  })
})

describe('the session expiring', () => {
  it('clears the list: a later enable loads it again', async () => {
    const send = await loadContentScript()
    await send({ action: 'enxRun' })

    await send({ action: 'sessionExpired' })
    reviewList = () => ({ success: true, reviewWords: [] })
    await send({ action: 'enxRun' })
    showAllObserved()

    expect(listRequests()).toHaveLength(2)
    expect(underlined()).toEqual({})
  })

  it('stops a response still in flight from restoring the old list', async () => {
    holdList = true
    const send = await loadContentScript()
    const run = send({ action: 'enxRun' })
    await settle()

    await send({ action: 'sessionExpired' })
    await releaseList()
    expect(await run).toMatchObject({
      success: false,
      reason: 'session-expired',
    })
    expect(sent.filter(m => m.type === 'learningModeStatus').at(-1)).toEqual({
      type: 'learningModeStatus',
      status: { status: 'error', reason: 'session-expired' },
    })
    holdList = false
    reviewList = () => ({ success: true, reviewWords: [] })
    await send({ action: 'enxRun' })
    showAllObserved()

    expect(listRequests()).toHaveLength(2)
    expect(underlined()).toEqual({})
  })

  it('clears words cached before a load the server refused as expired', async () => {
    const send = await loadContentScript()
    await send({ action: 'panelWordLookup', word: 'fox', ecp: FOX })
    reviewList = () => ({ success: false, sessionExpired: true })
    expect(await send({ action: 'enxRun' })).toMatchObject({
      reason: 'session-expired',
    })

    reviewList = () => ({ success: true, reviewWords: [] })
    await send({ action: 'enxRun' })
    showAllObserved()

    expect(underlined()).toEqual({})
  })
})

describe('word state changes after the load', () => {
  it('marking a list word known removes its underline; looking it up again restores it', async () => {
    const send = await loadContentScript()
    await send({ action: 'enxRun' })
    showAllObserved()
    lookup = () => ({ success: true, ecp: { ...FOX, Known: true } })

    await clickFox()
    // The lookup itself put fox back in review (P-7), one lookup on.
    expect(underlined()).toEqual({ 'enx-hl-1': ['Fox', 'fox’s', "FOX'S"] })
    await markKnownInPopover()
    expect(underlined()).toEqual({})

    await clickFox()
    expect(underlined()).toEqual({ 'enx-hl-1': ['Fox', 'fox’s', "FOX'S"] })
  })

  it('a side panel lookup of a known word restores its underline', async () => {
    const send = await loadContentScript()
    await send({ action: 'enxRun' })
    showAllObserved()
    await clickFox()
    await markKnownInPopover()
    expect(underlined()).toEqual({})

    await send({
      action: 'panelWordLookup',
      word: 'fox',
      ecp: { ...FOX, LoadCount: 4 },
    })
    await settle()

    expect(underlined()).toEqual({ 'enx-hl-2': ['Fox', 'fox’s', "FOX'S"] })
  })

  it('an AI definition of a word underlines it', async () => {
    reviewList = () => ({ success: true, reviewWords: [] })
    lookup = () => ({
      success: true,
      ecp: {
        Key: 'fox',
        English: 'fox',
        Chinese: '',
        Pronunciation: '',
        LoadCount: 0,
        Known: false,
        WordType: 0,
        AIFallback: { CanUse: true, Auto: true },
      },
    })
    ;(chrome.runtime.sendMessage as jest.Mock).mockImplementation(
      (message: Message, callback?: Callback) => {
        sent.push(message)
        if (!callback) return
        callback(
          message.type === 'defineWordWithAI'
            ? { success: true, data: { found: true, word: FOX } }
            : respond(message)
        )
      }
    )
    const send = await loadContentScript()
    await send({ action: 'enxRun' })
    showAllObserved()

    await clickFox()

    expect(underlined()).toEqual({ 'enx-hl-1': ['Fox', 'fox’s', "FOX'S"] })
  })
})

describe('the paint window', () => {
  const article = (paragraphs: string[]) => {
    document.body.innerHTML = `<article>${paragraphs
      .map(text => `<p>${text}</p>`)
      .join('')}</article>`
  }

  it('observes each block and underlines only the blocks in the window', async () => {
    article([ARTICLE_TEXT, 'A second fox far below.'])
    const send = await loadContentScript()
    await send({ action: 'enxRun' })

    const [observer] = liveIntersectionObservers()
    const blocks = [...document.querySelectorAll('article p')]
    expect(observer.observed).toEqual(blocks)
    expect(observer.options).toMatchObject({
      rootMargin: '100% 0px',
      scrollMargin: '100% 0px',
    })

    observer.fire([blocks[1]])
    expect(underlined()).toEqual({ 'enx-hl-1': ['fox'] })

    observer.fire([blocks[0]])
    observer.fire([blocks[1]], false)
    expect(underlined()).toEqual({ 'enx-hl-1': ['Fox', 'fox’s', "FOX'S"] })
  })

  it.each([
    ['an empty review list', { success: true, reviewWords: [] }],
    ['a failed list load', { success: false, error: 'boom' }],
  ])('after %s, a first lookup paints', async (_name, reply) => {
    reviewList = () => reply
    const send = await loadContentScript()
    await send({ action: 'enxRun' })
    showAllObserved()
    expect(underlined()).toEqual({})

    await clickFox()

    expect(underlined()).toEqual({ 'enx-hl-1': ['Fox', 'fox’s', "FOX'S"] })
  })

  it('a word change reads no storage', async () => {
    const send = await loadContentScript()
    await send({ action: 'enxRun' })
    showAllObserved()
    const reads = (chrome.storage.local.get as jest.Mock).mock.calls.length

    await send({
      action: 'panelWordLookup',
      word: 'fox',
      ecp: { ...FOX, LoadCount: 9 },
    })

    expect(underlined()).toEqual({ 'enx-hl-3': ['Fox', 'fox’s', "FOX'S"] })
    expect(chrome.storage.local.get).toHaveBeenCalledTimes(reads)
  })

  it('turning the preference off clears and disconnects; on repaints from the current words', async () => {
    const send = await loadContentScript()
    await send({ action: 'enxRun' })
    showAllObserved()
    const [first] = intersectionObservers()

    setHighlightPreference(false)
    expect(first.disconnected).toBe(true)
    expect(underlined()).toEqual({})
    await send({
      action: 'panelWordLookup',
      word: 'fox',
      ecp: { ...FOX, LoadCount: 9 },
    })
    expect(underlined()).toEqual({})

    setHighlightPreference(true)
    const live = liveIntersectionObservers()
    expect(live).toHaveLength(1)
    expect(live[0]).not.toBe(first)
    showAllObserved()
    expect(underlined()).toEqual({ 'enx-hl-3': ['Fox', 'fox’s', "FOX'S"] })

    first.fire()
    expect(underlined()).toEqual({ 'enx-hl-3': ['Fox', 'fox’s', "FOX'S"] })
  })

  it('disabling during a held load leaves no observer and no highlights', async () => {
    holdList = true
    const send = await loadContentScript()
    const run = send({ action: 'enxRun' })
    await settle()

    await send({ action: 'enxStop' })
    await releaseList()
    await run
    showAllObserved()

    expect(liveIntersectionObservers()).toEqual([])
    expect(underlined()).toEqual({})
  })

  it('disabling and re-enabling during a held load still paints', async () => {
    holdList = true
    const send = await loadContentScript()
    const run = send({ action: 'enxRun' })
    await settle()

    await send({ action: 'enxStop' })
    const rerun = send({ action: 'enxRun' })
    await settle()
    await releaseList()
    await run
    await rerun
    showAllObserved()

    expect(listRequests()).toHaveLength(1)
    expect(liveIntersectionObservers()).toHaveLength(1)
    expect(underlined()).toEqual({ 'enx-hl-1': ['Fox', 'fox’s', "FOX'S"] })
  })

  it.each([
    ['disabling', (send: Send) => send({ action: 'enxStop' })],
    [
      'the session expiring',
      (send: Send) => send({ action: 'sessionExpired' }),
    ],
  ])(
    '%s disconnects the observer, and its queued callback paints nothing',
    async (_name, end) => {
      const send = await loadContentScript()
      await send({ action: 'enxRun' })
      showAllObserved()
      const [observer] = intersectionObservers()

      await end(send)
      expect(observer.disconnected).toBe(true)
      expect(underlined()).toEqual({})

      observer.fire()
      expect(underlined()).toEqual({})
    }
  )

  it('an SPA switch disconnects the old observer, and its queued callback paints nothing', async () => {
    const { send, navigation } = await loadSpaScript()
    await send({ action: 'enxRun' })
    showAllObserved()
    const [old] = intersectionObservers()

    holdList = true
    reviewList = () => ({ success: true, reviewWords: [] })
    navigation.navigate('http://localhost/?article=2')
    expect(old.disconnected).toBe(true)
    expect(underlined()).toEqual({})

    old.fire()
    expect(underlined()).toEqual({})
  })
})
