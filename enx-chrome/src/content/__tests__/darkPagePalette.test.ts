// ADR-086 / #923: host-page highlight palette follows the article's text colour.

import { STAND_DOWN_EVENT } from '@/lib/orphanStandDown'
import type { SiteOrigins } from '@/lib/siteAdapters'
import { hostPageHighlightCss, type PageTone } from '@/lib/wordHighlight'

jest.mock('@/config/env')

let mockHoldLookup: ((release: () => void) => void) | null = null
jest.mock('@/lib/lookupArea', () => {
  const actual =
    jest.requireActual<typeof import('@/lib/lookupArea')>('@/lib/lookupArea')
  return {
    ...actual,
    resolveLookupArea: async (
      ...args: Parameters<typeof actual.resolveLookupArea>
    ) => {
      const area = await actual.resolveLookupArea(...args)
      if (mockHoldLookup) {
        const hold = mockHoldLookup
        mockHoldLookup = null
        await new Promise<void>(resolve => hold(resolve))
      }
      return area
    },
  }
})

type Message = { type?: string; action?: string }
type Callback = (response: unknown) => void

const ARTICLE_TEXT =
  'The fox and the lazy dog sleep while the patient reader keeps reading this paragraph about animals carefully.'
const LIVE_ID = 'abcdefghijklmnopqrstuvwxyzabcdef'

let sent: Message[]

const respond = (message: Message): unknown => {
  switch (message.type) {
    case 'getReviewWords':
      return { success: true, reviewWords: [['fox', 1]] }
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
  await new Promise(resolve => setTimeout(resolve, 150))
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

const SPA_ORIGINS = { rssxOrigins: ['http://localhost'] }

const loadSpaScript = async () => {
  const navigation = new FakeNavigation()
  ;(window as { navigation?: unknown }).navigation = navigation
  const send = await loadContentScript(SPA_ORIGINS)
  return { send, navigation }
}

const highlightStyleText = () =>
  document.head.querySelector('style[data-enx-highlight-styles]')
    ?.textContent ?? ''

const expectTone = (tone: PageTone) => {
  expect(highlightStyleText()).toBe(hostPageHighlightCss(tone))
}

const setColor = (el: Element, color: string) => {
  ;(el as HTMLElement).style.color = color
}

type MediaListener = (event: MediaQueryListEvent) => void

let mediaListeners: MediaListener[]
let matchMediaMock: jest.Mock

const installMatchMedia = () => {
  mediaListeners = []
  matchMediaMock = jest.fn((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: (_type: string, listener: MediaListener) => {
      mediaListeners.push(listener)
    },
    removeEventListener: (_type: string, listener: MediaListener) => {
      mediaListeners = mediaListeners.filter(l => l !== listener)
    },
    dispatchEvent: jest.fn(),
  }))
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: matchMediaMock,
  })
}

const fireColorSchemeChange = () => {
  const event = { matches: true } as MediaQueryListEvent
  mediaListeners.forEach(l => l(event))
}

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'debug').mockImplementation(() => {})
  mockHoldLookup = null
  sent = []
  ;(chrome.runtime as { id?: string }).id = LIVE_ID
  ;(chrome.runtime.sendMessage as jest.Mock).mockImplementation(
    (message: Message, callback?: Callback) => {
      sent.push(message)
      callback?.(respond(message))
    }
  )
  ;(chrome.storage.local.get as jest.Mock).mockResolvedValue({})
  document.head.innerHTML = ''
  document.body.innerHTML = `<article><p>${ARTICLE_TEXT}</p></article>`
  setColor(document.body, 'rgb(0, 0, 0)')
  setColor(document.querySelector('article')!, 'rgb(0, 0, 0)')
  delete (window as { navigation?: unknown }).navigation
  installMatchMedia()
})

afterEach(() => {
  ;(chrome.runtime as { id?: string }).id = undefined
  document.dispatchEvent(new Event(STAND_DOWN_EVENT))
  ;(chrome.runtime as { id?: string }).id = LIVE_ID
  jest.restoreAllMocks()
})

describe('dark-page highlight palette (ADR-086)', () => {
  it('writes the dark set when the article root has light text', async () => {
    setColor(document.querySelector('article')!, 'rgb(224, 224, 224)')
    const send = await loadContentScript()

    expect(await send({ action: 'enxRun' })).toMatchObject({ success: true })

    expectTone('dark')
  })

  it('writes the light set when the article root has dark text', async () => {
    setColor(document.querySelector('article')!, 'rgb(51, 51, 51)')
    const send = await loadContentScript()

    expect(await send({ action: 'enxRun' })).toMatchObject({ success: true })

    expectTone('light')
  })

  it("uses the delayed article node's colour, not body's", async () => {
    setColor(document.body, 'rgb(0, 0, 0)')
    document.body.innerHTML = ''
    const { send } = await loadSpaScript()

    const run = send({ action: 'enxRun' })
    await settle()

    const article = document.createElement('article')
    setColor(article, 'rgb(224, 224, 224)')
    const p = document.createElement('p')
    p.textContent = ARTICLE_TEXT
    article.appendChild(p)
    document.body.appendChild(article)
    await spaSettle()

    expect(await run).toMatchObject({ success: true })
    expectTone('dark')
  })

  it('rewrites the style on an SPA navigation to the other tone', async () => {
    setColor(document.querySelector('article')!, 'rgb(51, 51, 51)')
    const { send, navigation } = await loadSpaScript()
    expect(await send({ action: 'enxRun' })).toMatchObject({ success: true })
    expectTone('light')

    document.body.innerHTML = `<article><p>${ARTICLE_TEXT}</p></article>`
    setColor(document.querySelector('article')!, 'rgb(224, 224, 224)')
    navigation.navigate('http://localhost/?article=2')
    await spaSettle()

    expectTone('dark')
  })

  it('a rebuild superseded by a newer navigation does not write its tone', async () => {
    setColor(document.querySelector('article')!, 'rgb(51, 51, 51)')
    const { send, navigation } = await loadSpaScript()
    expect(await send({ action: 'enxRun' })).toMatchObject({ success: true })
    expectTone('light')

    let releaseOlder!: () => void
    const olderHeld = new Promise<void>(resolve => {
      mockHoldLookup = release => {
        releaseOlder = release
        resolve()
      }
    })
    navigation.navigate('http://localhost/?article=2')
    await olderHeld

    document.body.innerHTML = `<article><p>${ARTICLE_TEXT}</p></article>`
    setColor(document.querySelector('article')!, 'rgb(224, 224, 224)')
    navigation.navigate('http://localhost/?article=3')
    await spaSettle()
    expectTone('dark')

    const style = document.head.querySelector(
      'style[data-enx-highlight-styles]'
    )!
    const writes: MutationRecord[] = []
    const observer = new MutationObserver(records => writes.push(...records))
    observer.observe(style, {
      childList: true,
      characterData: true,
      subtree: true,
    })
    releaseOlder()
    await settle()
    observer.disconnect()

    expect(writes).toHaveLength(0)
    expectTone('dark')
  })

  it('re-evaluates tone on prefers-color-scheme change, and stops after disable', async () => {
    setColor(document.querySelector('article')!, 'rgb(51, 51, 51)')
    const send = await loadContentScript()
    expect(await send({ action: 'enxRun' })).toMatchObject({ success: true })
    expectTone('light')
    expect(matchMediaMock).toHaveBeenCalledWith('(prefers-color-scheme: dark)')

    setColor(document.querySelector('article')!, 'rgb(224, 224, 224)')
    fireColorSchemeChange()
    expectTone('dark')

    expect(await send({ action: 'enxStop' })).toMatchObject({ success: true })
    const listenersAfterStop = mediaListeners.length
    setColor(document.querySelector('article')!, 'rgb(51, 51, 51)')
    fireColorSchemeChange()
    expect(mediaListeners.length).toBe(0)
    expect(listenersAfterStop).toBe(0)
    // Style stays on the last tone written while enabled (dark); no rewrite.
    expectTone('dark')
  })
})
