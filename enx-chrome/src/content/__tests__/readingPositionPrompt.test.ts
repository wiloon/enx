// Reading positions (ADR-081 Decision 3, #897): with learning mode on, a
// book with a position gets a corner prompt; clicking it scrolls to the
// sentence and flashes it, without the side panel. These tests load the real
// content script against a jsdom page and a fake background.

import { STAND_DOWN_EVENT } from '@/lib/orphanStandDown'
import { buildReadingAnchor } from '@/lib/readingAnchor'
import type { ReadingAnchor } from '@/lib/readingPositions'

jest.mock('@/config/env')

type Message = { type?: string; action?: string; bookKey?: string }

const LIVE_ID = 'abcdefghijklmnopqrstuvwxyzabcdef'
const PAGE_URL = 'http://localhost/ebooks/austen/sense?utm_source=feed#ch1'
const BOOK = 'http://localhost/ebooks/austen/sense'

const STORY = 'The reader turns another page of the long story. '.repeat(16)
const RESIDENCE =
  'Their estate was large, and their residence was at Norland Park, in the centre of their property.'

const page = (prelude = '') => `
  <article>
    <h1>Sense and Sensibility</h1>
    ${prelude}
    <p id="one">The family of Dashwood had long been settled in Sussex.   Their estate
      was large, and their residence was at <em>Norland Park</em>, in the centre of their property.</p>
    <p id="two">${STORY}</p>
  </article>`

const ARTICLE = `Sense and Sensibility The family of Dashwood had long been settled in Sussex. ${RESIDENCE} ${STORY.trim()}`

const anchorOf = (sentence: string): ReadingAnchor =>
  buildReadingAnchor(
    ARTICLE,
    ARTICLE.indexOf(sentence),
    sentence,
    { sourceUrl: BOOK, title: 'Sense and Sensibility' },
    1_600_000_000_000
  )!

let sent: Message[]
let stored: ReadingAnchor | null
let recordReply: unknown
let openReply: () => unknown

const respond = (message: Message & { word?: string }): unknown => {
  switch (message.type) {
    case 'getReviewWords':
      return { success: true, reviewWords: [] }
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
      return { success: true, autoEnable: false }
    case 'openReadingPosition':
      return openReply()
    case 'recordReadingPosition':
      return recordReply
    default:
      return { success: true }
  }
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0))
const settle = async () => {
  for (let i = 0; i < 10; i++) await flush()
}

let sendToContent: (request: unknown) => Promise<Record<string, unknown>>

const loadContentScript = async () => {
  await jest.isolateModulesAsync(async () => {
    await import('../content')
  })
  const calls = (chrome.runtime.onMessage.addListener as jest.Mock).mock.calls
  const listener = calls[calls.length - 1][0] as (
    request: unknown,
    sender: unknown,
    sendResponse: (r: unknown) => void
  ) => unknown
  sendToContent = request =>
    new Promise(resolve => {
      listener(request, {}, resolve as (r: unknown) => void)
    })
}

const enable = async () => {
  await loadContentScript()
  expect(await sendToContent({ action: 'enxRun' })).toMatchObject({
    success: true,
  })
  await settle()
}

const prompt = () =>
  document
    .querySelector('.enx-reading-position-prompt')
    ?.shadowRoot?.querySelector<HTMLElement>(
      '[data-testid="reading-position-prompt"]'
    ) ?? null

const notice = () =>
  document
    .querySelector('.enx-reading-position-notice')
    ?.shadowRoot?.querySelector<HTMLElement>(
      '[data-testid="reading-position-notice"]'
    ) ?? null

const button = (name: RegExp) =>
  [...(prompt()?.querySelectorAll('button') ?? [])].find(b =>
    name.test(b.getAttribute('aria-label') ?? b.textContent ?? '')
  )!

const flashed = () =>
  [...(CSS.highlights.get('enx-reading-position') ?? [])] as Range[]

let scrolled: Element[]

const textHolding = (selector: string, text: string): Text => {
  const walker = document.createTreeWalker(
    document.querySelector(selector)!,
    NodeFilter.SHOW_TEXT
  )
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if ((node as Text).data.includes(text)) return node as Text
  }
  throw new Error(`no text "${text}" under ${selector}`)
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
  stored = anchorOf(RESIDENCE)
  recordReply = { ok: true }
  openReply = () =>
    stored ? { ok: true, position: stored } : { ok: true, position: null }
  scrolled = []
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this)
  }
  ;(chrome.runtime as { id?: string }).id = LIVE_ID
  ;(chrome.runtime.sendMessage as jest.Mock).mockImplementation(
    (message: Message, callback?: (response: unknown) => void) => {
      sent.push(message)
      if (callback) callback(respond(message))
    }
  )
  ;(chrome.storage.local.get as jest.Mock).mockResolvedValue({})
  window.history.replaceState({}, '', PAGE_URL)
  document.head.innerHTML = ''
  document.title = 'Sense and Sensibility'
  document.body.innerHTML = page()
  jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
})

afterEach(() => {
  ;(chrome.runtime as { id?: string }).id = undefined
  document.dispatchEvent(new Event(STAND_DOWN_EVENT))
  ;(chrome.runtime as { id?: string }).id = LIVE_ID
  CSS.highlights.clear()
  jest.restoreAllMocks()
})

describe('the reading position prompt', () => {
  it('asks for the book’s position when learning mode turns on and shows the sentence’s start', async () => {
    await enable()

    expect(sent).toContainEqual({ type: 'openReadingPosition', bookKey: BOOK })
    expect(prompt()).not.toBeNull()
    expect(prompt()!.textContent).toContain('Their estate was large')
  })

  it('shows nothing for a book with no position', async () => {
    stored = null
    await enable()

    expect(prompt()).toBeNull()
  })

  it('shows nothing while signed out', async () => {
    openReply = () => ({ ok: false, code: 'signed-out' })
    await enable()

    expect(prompt()).toBeNull()
  })

  it('asks for nothing before learning mode is on', async () => {
    await loadContentScript()
    await settle()

    expect(sent.some(m => m.type === 'openReadingPosition')).toBe(false)
    expect(prompt()).toBeNull()
  })

  it('hides when dismissed, without scrolling or flashing', async () => {
    await enable()

    button(/dismiss/i).click()
    await settle()

    expect(prompt()).toBeNull()
    expect(scrolled).toEqual([])
    expect(flashed()).toEqual([])
  })

  it('jumps to the sentence and flashes it on click, leaving the side panel closed', async () => {
    await enable()
    const before = sent.length

    button(/continue reading/i).click()
    await settle()

    expect(prompt()).toBeNull()
    expect(flashed()).toHaveLength(1)
    expect(flashed()[0].toString().replace(/\s+/g, ' ')).toBe(RESIDENCE)
    expect(scrolled).toEqual([document.querySelector('#one')])
    expect(sent.slice(before)).toEqual([])
    expect(chrome.sidePanel.open).not.toHaveBeenCalled()
  })

  it('finds a repeated sentence by its context after the page changed', async () => {
    const repeated = 'The reader turns another page of the long story.'
    // The last of sixteen repeats: every later repeat's context matches as
    // well, so the one nearest the old offset must win.
    const offset = ARTICLE.lastIndexOf(repeated)
    stored = buildReadingAnchor(
      ARTICLE,
      offset,
      repeated,
      { sourceUrl: BOOK, title: 'Sense and Sensibility' },
      1
    )
    document.body.innerHTML = page('<p id="preface">A new preface.</p>')
    await enable()

    button(/continue reading/i).click()
    await settle()

    const story = textHolding('#two', repeated)
    expect(flashed()).toHaveLength(1)
    expect(flashed()[0].startContainer).toBe(story)
    expect(flashed()[0].startOffset).toBe(story.data.lastIndexOf(repeated))
  })

  it('scrolls near where an absent sentence was and says it was not found', async () => {
    stored = {
      ...anchorOf(RESIDENCE),
      sentence: 'A sentence the page no longer has.',
      before: '',
      after: '',
      offset: Math.round(ARTICLE.length * 0.9),
      articleLength: ARTICLE.length,
    }
    await enable()

    button(/continue reading/i).click()
    await settle()

    expect(flashed()).toEqual([])
    expect(scrolled).toEqual([document.querySelector('#two')])
    expect(notice()?.textContent).toMatch(/couldn.t find/i)
  })

  it('hides once a new sentence on this page becomes the position', async () => {
    await enable()
    expect(prompt()).not.toBeNull()

    await clickWord('#one', 'Dashwood')

    expect(sent.some(m => m.type === 'recordReadingPosition')).toBe(true)
    expect(prompt()).toBeNull()
  })

  it('hides when learning mode turns off', async () => {
    await enable()

    await sendToContent({ action: 'enxStop' })

    expect(prompt()).toBeNull()
  })
})

describe('a reading position that is not saved', () => {
  it('says so once per page session, never that it was saved', async () => {
    stored = null
    recordReply = { ok: false, code: 'storage-full' }
    await enable()

    await clickWord('#one', 'Dashwood')
    expect(notice()?.textContent).toMatch(/wasn.t saved/i)

    notice()!.querySelector('button')!.click()
    await settle()
    expect(notice()).toBeNull()

    recordReply = { ok: false, code: 'write-failed' }
    await clickWord('#one', 'residence')
    expect(notice()).toBeNull()
  })

  it('says nothing when the write succeeds', async () => {
    stored = null
    await enable()

    await clickWord('#one', 'Dashwood')

    expect(notice()).toBeNull()
  })
})
