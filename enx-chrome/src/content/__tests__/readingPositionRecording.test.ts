// Reading positions (ADR-081 Decision 1, ADR-082, #897): a click lookup, a
// phrase lookup and a drag-select translation each send the sentence's
// anchor to the background writer at once. These tests load the real
// content script against a jsdom page and a fake background.

import { STAND_DOWN_EVENT } from '@/lib/orphanStandDown'

jest.mock('@/config/env')

type Message = {
  type?: string
  action?: string
  bookKey?: string
  anchor?: Record<string, unknown>
}

const LIVE_ID = 'abcdefghijklmnopqrstuvwxyzabcdef'
const PAGE_URL = 'http://localhost/ebooks/austen/sense?utm_source=feed#ch1'
const BOOK = 'http://localhost/ebooks/austen/sense'

const ECP = (word: string) => ({
  Key: word,
  English: word,
  Chinese: '词',
  Pronunciation: '',
  LoadCount: 1,
  Known: false,
  WordType: 0,
})

let sent: Message[]

const respond = (message: Message & { word?: string }): unknown => {
  switch (message.type) {
    case 'getReviewWords':
      return { success: true, reviewWords: [] }
    case 'getOneWord':
      return { success: true, ecp: ECP(message.word ?? 'word') }
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
  return (request: unknown) =>
    new Promise<Record<string, unknown>>(resolve => {
      listener(request, {}, resolve as (r: unknown) => void)
    })
}

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

// Selects from the start of `from` to the end of `to` and releases the mouse.
const select = async (
  from: [selector: string, text: string],
  to: [selector: string, text: string]
) => {
  const start = textHolding(...from)
  const end = textHolding(...to)
  const range = document.createRange()
  range.setStart(start, start.data.indexOf(from[1]))
  range.setEnd(end, end.data.indexOf(to[1]) + to[1].length)
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
  end.parentElement!.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  await settle()
}

const clickTranslateButton = async () => {
  const overlay = document.querySelector('.enx-selection-translate-button')
  overlay!.shadowRoot!.querySelector('button')!.click()
  await settle()
}

const positions = () => sent.filter(m => m.type === 'recordReadingPosition')
const flushes = () => sent.filter(m => m.type === 'flushReadingPositions')

const STORY = 'The reader turns another page of the long story. '.repeat(16)

const BOOK_PAGE = `
  <nav><a href="/">Standard Ebooks</a></nav>
  <article>
    <h1>Sense and Sensibility</h1>
    <p id="one">The family of Dashwood had long been settled in Sussex.   Their estate
      was large, and their residence was at <em>Norland Park</em>, in the centre of their property.</p>
    <p id="two">${STORY}</p>
  </article>`

const ARTICLE = `Sense and Sensibility The family of Dashwood had long been settled in Sussex. Their estate was large, and their residence was at Norland Park, in the centre of their property. ${STORY.trim()}`

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
  document.body.innerHTML = BOOK_PAGE
  jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
})

afterEach(() => {
  ;(chrome.runtime as { id?: string }).id = undefined
  document.dispatchEvent(new Event(STAND_DOWN_EVENT))
  ;(chrome.runtime as { id?: string }).id = LIVE_ID
  CSS.highlights.clear()
  jest.restoreAllMocks()
})

const enable = async () => {
  const send = await loadContentScript()
  expect(await send({ action: 'enxRun' })).toMatchObject({ success: true })
}

const RESIDENCE_SENTENCE =
  'Their estate was large, and their residence was at Norland Park, in the centre of their property.'

describe('recording a reading position', () => {
  it('sends the clicked word’s sentence, located in the article, for a click lookup', async () => {
    await enable()

    await clickWord('#one', 'residence')

    const offset = ARTICLE.indexOf('Their estate')
    expect(positions()).toEqual([
      {
        type: 'recordReadingPosition',
        bookKey: BOOK,
        anchor: {
          sentence: RESIDENCE_SENTENCE,
          before: 'ad long been settled in Sussex. ',
          after: ' The reader turns another page o',
          offset,
          articleLength: ARTICLE.length,
          sourceUrl: BOOK,
          title: 'Sense and Sensibility',
          occurredAt: 1_700_000_000_000,
        },
      },
    ])
  })

  it('sends the sentence around a phrase once the phrase is looked up', async () => {
    await enable()

    await select(['#one', 'long been'], ['#one', 'settled'])
    expect(positions()).toEqual([])
    await clickTranslateButton()

    expect(positions()).toHaveLength(1)
    expect(positions()[0].anchor).toMatchObject({
      sentence: 'The family of Dashwood had long been settled in Sussex.',
      before: 'Sense and Sensibility ',
      offset: ARTICLE.indexOf('The family'),
    })
  })

  it('sends the selected text itself for a drag-select translation', async () => {
    await enable()

    await select(['#one', 'Their estate'], ['#one em', 'Norland Park'])
    await clickTranslateButton()

    expect(sent.some(m => m.type === 'openSentencePanel')).toBe(true)
    expect(positions()).toHaveLength(1)
    expect(positions()[0].anchor).toMatchObject({
      sentence:
        'Their estate was large, and their residence was at Norland Park',
      offset: ARTICLE.indexOf('Their estate'),
    })
  })

  it('sends nothing for a sentence it cannot locate in the article', async () => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<aside id="aside"><p>Outside the article stands a sidebar note.</p></aside>'
    )
    await enable()

    await select(['#aside', 'Outside'], ['#aside', 'stands'])
    await clickTranslateButton()

    expect(sent.some(m => m.type === 'openSentencePanel')).toBe(true)
    expect(positions()).toEqual([])
  })

  it('asks the background to write at once when the tab is hidden or unloads', async () => {
    await enable()
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('pagehide'))
    expect(flushes()).toEqual([])

    await clickWord('#one', 'residence')
    jest.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(flushes()).toHaveLength(1)

    await clickWord('#one', 'Dashwood')
    window.dispatchEvent(new Event('pagehide'))
    expect(flushes()).toHaveLength(2)
  })
})
