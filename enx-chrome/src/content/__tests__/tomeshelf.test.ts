// ADR-088 / #907: tomeshelf late recognition, book key, resume-hint suppress,
// and superseded auto-enable races. Loads the real content script against a
// jsdom page and a fake background.

import { STAND_DOWN_EVENT } from '@/lib/orphanStandDown'
import { buildReadingAnchor } from '@/lib/readingAnchor'
import type { ReadingAnchor } from '@/lib/readingPositions'
import { tomeshelfBookKey } from '@/lib/siteAdapters'

jest.mock('@/config/env')

type Message = {
  type?: string
  action?: string
  bookKey?: string
  status?: unknown
  word?: string
}

const LIVE_ID = 'abcdefghijklmnopqrstuvwxyzabcdef'
const DOC1 =
  'The quick brown fox jumps over the lazy dog while the patient reader keeps reading this paragraph about foxes.'
const DOC2 =
  'A second document introduces the word zebra found only after the in-page navigation replaces the article.'

let sent: Message[]
let autoEnable: boolean
let wordsSessionExpired: boolean
let stored: ReadingAnchor | null
let openReply: () => unknown

let loadReadabilityDeferred: {
  promise: Promise<unknown>
  resolve: (value: unknown) => void
  reject: (error: Error) => void
} | null

jest.mock('../loadReadability', () => ({
  loadReadability: () => {
    if (!loadReadabilityDeferred) {
      return Promise.reject(new Error('loadReadability not deferred'))
    }
    return loadReadabilityDeferred.promise
  },
}))

const respond = (message: Message): unknown => {
  switch (message.type) {
    case 'getReviewWords':
      return wordsSessionExpired
        ? { success: false, sessionExpired: true }
        : {
            success: true,
            reviewWords: [
              ['fox', 1],
              ['zebra', 1],
            ],
          }
    case 'getOneWord':
      return {
        success: true,
        ecp: {
          Key: message.word,
          English: message.word,
          Chinese: '词',
          Pronunciation: '',
          LoadCount: 1,
          Known: false,
          WordType: 0,
        },
      }
    case 'shouldAutoEnable':
      return { success: true, autoEnable }
    case 'openReadingPosition':
      return openReply()
    case 'recordReadingPosition':
      return { ok: true }
    default:
      return { success: true }
  }
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0))
const settle = async () => {
  for (let i = 0; i < 15; i++) await flush()
}
const spaSettle = async () => {
  await new Promise(resolve => setTimeout(resolve, 150))
  await settle()
}

type Send = (request: unknown) => Promise<Record<string, unknown>>

const loadContentScript = async (): Promise<Send> => {
  await jest.isolateModulesAsync(async () => {
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

const statuses = () =>
  sent.filter(m => m.type === 'learningModeStatus').map(m => m.status)

const insertTomeshelf = (
  opts: {
    book?: string
    restores?: boolean
    body?: string
  } = {}
) => {
  const generator = document.createElement('meta')
  generator.setAttribute('name', 'generator')
  generator.setAttribute('content', 'tomeshelf 1.0.0')
  document.head.appendChild(generator)
  if (opts.book) {
    const book = document.createElement('meta')
    book.setAttribute('name', 'tomeshelf:book')
    book.setAttribute('content', opts.book)
    document.head.appendChild(book)
  }
  if (opts.restores) {
    const restores = document.createElement('meta')
    restores.setAttribute('name', 'tomeshelf:restores-position')
    restores.setAttribute('content', 'true')
    document.head.appendChild(restores)
  }
  document.body.innerHTML = `<article id="tomeshelf-content" data-tomeshelf-block="1"><p id="one">${opts.body ?? DOC1}</p></article>`
}

const textHolding = (selector: string, word: string): Text => {
  const walker = document.createTreeWalker(
    document.querySelector(selector)!,
    NodeFilter.SHOW_TEXT
  )
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if ((node as Text).data.includes(word)) return node as Text
  }
  throw new Error(`no text "${word}" under ${selector}`)
}

const clickWord = async (selector: string, word: string) => {
  const text = textHolding(selector, word)
  const offset = text.data.indexOf(word) + 1
  ;(
    document as unknown as {
      caretPositionFromPoint: (x: number, y: number) => unknown
    }
  ).caretPositionFromPoint = () => ({ offsetNode: text, offset })
  text.parentElement!.dispatchEvent(
    new MouseEvent('click', { bubbles: true, clientX: 5, clientY: 5 })
  )
  await settle()
}

const prompt = () =>
  document
    .querySelector('.enx-reading-position-prompt')
    ?.shadowRoot?.querySelector<HTMLElement>(
      '[data-testid="reading-position-prompt"]'
    ) ?? null

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
  autoEnable = false
  wordsSessionExpired = false
  stored = null
  openReply = () =>
    stored ? { ok: true, position: stored } : { ok: true, position: null }
  loadReadabilityDeferred = null
  ;(chrome.runtime as { id?: string }).id = LIVE_ID
  ;(chrome.runtime.sendMessage as jest.Mock).mockImplementation(
    (message: Message, callback?: (response: unknown) => void) => {
      sent.push(message)
      callback?.(respond(message))
    }
  )
  ;(chrome.runtime.getManifest as jest.Mock).mockReturnValue({
    version: '0.0.0-test',
  })
  ;(chrome.storage.local.get as jest.Mock).mockResolvedValue({})
  ;(chrome.storage.local.set as jest.Mock).mockResolvedValue(undefined)
  window.history.replaceState({}, '', 'http://localhost/books/x/read/1')
  document.head.innerHTML = ''
  document.body.innerHTML = ''
  document.title = 'Tomeshelf book'
  delete (window as { navigation?: unknown }).navigation
})

afterEach(() => {
  ;(chrome.runtime as { id?: string }).id = undefined
  document.dispatchEvent(new Event(STAND_DOWN_EVENT))
  ;(chrome.runtime as { id?: string }).id = LIVE_ID
  CSS.highlights.clear()
  jest.restoreAllMocks()
})

describe('tomeshelf late recognition (ADR-088)', () => {
  it('re-runs auto-enable as tomeshelf after a default-adapter rollback', async () => {
    autoEnable = true
    wordsSessionExpired = true
    ;(window as { navigation?: unknown }).navigation = new FakeNavigation()
    document.body.innerHTML = `<article><p>${DOC1}</p></article>`
    const send = await loadContentScript()
    await settle()
    expect((await send({ action: 'getPageInfo' })).isEnxEnabled).toBe(false)

    wordsSessionExpired = false
    insertTomeshelf()
    await spaSettle()

    expect((statuses().at(-1) as { status: string })?.status).toBe('ready')
    expect((await send({ action: 'getPageInfo' })).isEnxEnabled).toBe(true)
    await clickWord('#tomeshelf-content', 'fox')
    expect(document.querySelector('#enx-anchored-overlay')).not.toBeNull()
  })

  it('cancels a pending run and re-enables as tomeshelf when already on', async () => {
    ;(window as { navigation?: unknown }).navigation = new FakeNavigation()
    document.body.innerHTML = `<article><p>${DOC1}</p></article>`
    const send = await loadContentScript()
    expect(await send({ action: 'enxRun' })).toMatchObject({ success: true })
    await settle()

    insertTomeshelf()
    await spaSettle()

    expect((statuses().at(-1) as { status: string })?.status).toBe('ready')
    await clickWord('#tomeshelf-content', 'fox')
    expect(document.querySelector('#enx-anchored-overlay')).not.toBeNull()
  })

  it('does nothing when the user turned learning mode off', async () => {
    ;(window as { navigation?: unknown }).navigation = new FakeNavigation()
    document.body.innerHTML = `<article><p>${DOC1}</p></article>`
    const send = await loadContentScript()
    await send({ action: 'enxRun' })
    await settle()
    await send({ action: 'enxStop' })
    sent = []

    insertTomeshelf()
    await spaSettle()

    expect(statuses()).toEqual([])
    expect((await send({ action: 'getPageInfo' })).isEnxEnabled).toBe(false)
  })
})

describe('tomeshelf superseded auto-enable race (ADR-088)', () => {
  const startDeferredReadability = () => {
    let resolve!: (value: unknown) => void
    let reject!: (error: Error) => void
    const promise = new Promise((res, rej) => {
      resolve = res
      reject = rej
    })
    loadReadabilityDeferred = { promise, resolve, reject }
  }

  const jsonLdPage = () => {
    // No article/main; JSON-LD Article so default resolveLookupArea reaches
    // layer 6 and waits in loadReadability().
    document.head.innerHTML = ''
    document.body.innerHTML = `
      <script type="application/ld+json">{"@type":"Article","headline":"A"}</script>
      <div>not enough text for the default min length alone</div>`
  }

  it.each(['reject', 'resolve'] as const)(
    'keeps tomeshelf on after the superseded default attempt %ss',
    async settleHow => {
      autoEnable = true
      ;(window as { navigation?: unknown }).navigation = new FakeNavigation()
      startDeferredReadability()
      jsonLdPage()
      await loadContentScript()
      await settle()
      expect(loadReadabilityDeferred).not.toBeNull()

      insertTomeshelf({ body: DOC1 })
      await spaSettle()

      expect((statuses().at(-1) as { status: string })?.status).toBe('ready')
      await clickWord('#tomeshelf-content', 'fox')
      expect(document.querySelector('#enx-anchored-overlay')).not.toBeNull()

      const beforeSettle = statuses().slice()
      if (settleHow === 'reject') {
        loadReadabilityDeferred!.reject(new Error('stale readability'))
      } else {
        loadReadabilityDeferred!.resolve(
          class {
            parse() {
              return null
            }
          }
        )
      }
      await settle()

      expect((statuses().at(-1) as { status: string })?.status).toBe('ready')
      expect(
        statuses()
          .slice(beforeSettle.length)
          .some(s => (s as { status: string }).status === 'off')
      ).toBe(false)
      await clickWord('#tomeshelf-content', 'fox')
      expect(document.querySelector('#enx-anchored-overlay')).not.toBeNull()
    }
  )
})

describe('tomeshelf reading positions', () => {
  it('records with the shared book key', async () => {
    ;(window as { navigation?: unknown }).navigation = new FakeNavigation()
    insertTomeshelf({ book: 'book-9f2c' })
    const send = await loadContentScript()
    await send({ action: 'enxRun' })
    await spaSettle()

    await clickWord('#tomeshelf-content', 'fox')
    const recorded = sent.find(m => m.type === 'recordReadingPosition')
    expect(recorded?.bookKey).toBe(
      tomeshelfBookKey('http://localhost/books/x/read/1', 'book-9f2c')
    )
  })

  it('hides the resume hint when tomeshelf restores position, and shows it again after an in-page nav that removes the meta', async () => {
    const navigation = new FakeNavigation()
    ;(window as { navigation?: unknown }).navigation = navigation
    const bookKey = tomeshelfBookKey(
      'http://localhost/books/x/read/1',
      'book-9f2c'
    )
    stored = buildReadingAnchor(
      DOC1,
      DOC1.indexOf('The quick'),
      'The quick brown fox jumps over the lazy dog while the patient reader keeps reading this paragraph about foxes.',
      { sourceUrl: 'http://localhost/books/x/read/1', title: 'Tomeshelf book' },
      1
    )

    insertTomeshelf({ book: 'book-9f2c', restores: true })
    const send = await loadContentScript()
    await send({ action: 'enxRun' })
    await spaSettle()
    expect(sent).toContainEqual({
      type: 'openReadingPosition',
      bookKey,
    })
    expect(prompt()).toBeNull()

    // In-page nav that drops restores-position.
    document.querySelector('meta[name="tomeshelf:restores-position"]')?.remove()
    document.body.innerHTML = `<article id="tomeshelf-content"><p>${DOC2}</p></article>`
    window.history.pushState({}, '', 'http://localhost/books/x/read/2')
    navigation.navigate('http://localhost/books/x/read/2')
    await spaSettle()
    expect(prompt()).not.toBeNull()

    // Add restores-position back on the next document.
    const restores = document.createElement('meta')
    restores.setAttribute('name', 'tomeshelf:restores-position')
    restores.setAttribute('content', 'true')
    document.head.appendChild(restores)
    document.body.innerHTML = `<article id="tomeshelf-content"><p>${DOC1}</p></article>`
    navigation.navigate('http://localhost/books/x/read/3')
    await spaSettle()
    expect(prompt()).toBeNull()
  })
})
