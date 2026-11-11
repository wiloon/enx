// ADR-079 Decision 4: each successful article processing run asks the worker
// to prefetch the definitions of the page words it highlights. These tests
// load the real content script against a jsdom page and a fake background.

import { STAND_DOWN_EVENT } from '@/lib/orphanStandDown'
import type { SiteOrigins } from '@/lib/siteAdapters'
import { WORD_HIGHLIGHT_KEY } from '@/config/preferences'

jest.mock('@/config/env')

type Message = { type?: string; words?: string[] }
type Callback = (response: unknown) => void

const ARTICLE_TEXT =
  "The Fox and the fox’s den and FOX'S tail, while the lazy dog sleeps " +
  'and the patient reader keeps reading this paragraph about animals.'
const LIVE_ID = 'abcdefghijklmnopqrstuvwxyzabcdef'

let sent: Message[]
let reviewList: () => unknown
let holdList: boolean
let heldList: Callback[]

const respond = (message: Message): unknown => {
  switch (message.type) {
    case 'getReviewWords':
      return reviewList()
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
const loadSpaScript = async () => {
  const navigation = new FakeNavigation()
  ;(window as { navigation?: unknown }).navigation = navigation
  const send = await loadContentScript({ rssxOrigins: ['http://localhost'] })
  return { send, navigation }
}

const prefetches = () =>
  sent.filter(m => m.type === 'prefetchDefinitions').map(m => m.words)

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'debug').mockImplementation(() => {})
  sent = []
  heldList = []
  holdList = false
  // "cat" is on the list but not on the page.
  reviewList = () => ({
    success: true,
    reviewWords: [
      ['fox', 1],
      ['dog', 4],
      ['cat', 2],
    ],
  })
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

describe('a processing run', () => {
  it('asks once for the highlighted page words, by cache key and without repeats', async () => {
    const send = await loadContentScript()
    await send({ action: 'enxRun' })

    expect(prefetches()).toEqual([['fox', 'dog']])
  })

  it('asks before any word enters the paint window', async () => {
    const send = await loadContentScript()
    await send({ action: 'enxRun' })

    expect(CSS.highlights.size).toBe(0)
    expect(prefetches()).toHaveLength(1)
  })

  it('asks for nothing when the highlight preference is off', async () => {
    ;(chrome.storage.local.get as jest.Mock).mockResolvedValue({
      [WORD_HIGHLIGHT_KEY]: false,
    })
    const send = await loadContentScript()
    await send({ action: 'enxRun' })

    expect(prefetches()).toEqual([])
  })

  it('asks for nothing on a whole page, which has no highlights', async () => {
    document.body.innerHTML = `<div><p>The quick brown fox jumps over the lazy dog.</p></div>`
    const send = await loadContentScript()
    await send({ action: 'enxRun' })

    expect(prefetches()).toEqual([])
  })

  it('asks for nothing when signed out', async () => {
    reviewList = () => ({ success: false, sessionExpired: true })
    const send = await loadContentScript()
    await send({ action: 'enxRun' })

    expect(prefetches()).toEqual([])
  })

  it('asks for nothing when learning mode was turned off during the load', async () => {
    holdList = true
    const send = await loadContentScript()
    const run = send({ action: 'enxRun' })
    await settle()
    await send({ action: 'enxStop' })
    await releaseList()
    await run

    expect(prefetches()).toEqual([])
  })
})

describe('what a page has asked for', () => {
  it('is kept when learning mode is turned off and on again', async () => {
    const send = await loadContentScript()
    await send({ action: 'enxRun' })
    await send({ action: 'enxStop' })
    await send({ action: 'enxRun' })
    await send({ action: 'enxRun' })

    expect(prefetches()).toEqual([['fox', 'dog']])
  })

  it('is forgotten by an SPA rebuild', async () => {
    const { send, navigation } = await loadSpaScript()
    await send({ action: 'enxRun' })

    navigation.navigate('http://localhost/?article=2')
    await spaSettle()

    expect(prefetches()).toEqual([
      ['fox', 'dog'],
      ['fox', 'dog'],
    ])
  })

  it('is asked for only by the newer run when an SPA switch lands during the load', async () => {
    holdList = true
    const { send, navigation } = await loadSpaScript()
    const run = send({ action: 'enxRun' })
    await spaSettle()

    navigation.navigate('http://localhost/?article=2')
    await spaSettle()
    await releaseList()
    await run
    await spaSettle()

    expect(prefetches()).toEqual([['fox', 'dog']])
  })

  it('is forgotten when the session ends', async () => {
    const send = await loadContentScript()
    await send({ action: 'enxRun' })

    await send({ action: 'sessionExpired', cause: 'signed-out' })
    await send({ action: 'enxRun' })

    expect(prefetches()).toEqual([
      ['fox', 'dog'],
      ['fox', 'dog'],
    ])
  })

  it('is forgotten when the account changes', async () => {
    const send = await loadContentScript()
    await send({ action: 'enxRun' })

    await send({ action: 'accountChanged' })
    await send({ action: 'enxRun' })

    expect(prefetches()).toEqual([
      ['fox', 'dog'],
      ['fox', 'dog'],
    ])
  })
})
