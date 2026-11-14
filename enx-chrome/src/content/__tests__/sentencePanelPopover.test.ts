// ADR-085: the word popover's sentence button sends the sentence to the side
// panel. Once the panel really opened the popover closes; otherwise it stays
// with the "click the toolbar icon" hint. The clicked word gets its own mark
// next to the active sentence highlight (ADR-025), with the same lifetime.
// These tests load the real content script against a jsdom page and a fake
// background.

import { STAND_DOWN_EVENT } from '@/lib/orphanStandDown'

jest.mock('@/config/env')

type Message = { type?: string; action?: string; word?: string }
type Callback = (response: unknown) => void

const LIVE_ID = 'abcdefghijklmnopqrstuvwxyzabcdef'

const PAGE = `
  <article>
    <h1>Sense and Sensibility</h1>
    <p id="one">The family of Dashwood had long been settled in Sussex. Their estate
      was large, and their residence was at Norland Park, in the centre of their property.</p>
    <p id="two">${'The reader turns another page of the long story. '.repeat(16)}</p>
  </article>`

let sent: Message[]
let openSentencePanel: (callback: Callback) => void

const respond = (message: Message): unknown => {
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
      return { ok: true, position: null }
    default:
      return { success: true }
  }
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0))
const settle = async () => {
  for (let i = 0; i < 10; i++) await flush()
}

let sendToContent: (request: unknown) => Promise<Record<string, unknown>>

const enable = async () => {
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
  expect(await sendToContent({ action: 'enxRun' })).toMatchObject({
    success: true,
  })
  await settle()
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

const popover = () =>
  document.querySelector('#enx-anchored-overlay')?.shadowRoot ?? null

const popoverWord = () =>
  popover()?.querySelector('[data-testid="word-popover-header"]')?.textContent

const hint = () =>
  popover()?.querySelector('[data-testid="word-popover-sentence-panel-hint"]')
    ?.textContent ?? null

const sendSentence = async () => {
  popover()!
    .querySelector<HTMLButtonElement>(
      '[data-testid="word-popover-sentence-translation"]'
    )!
    .click()
  await settle()
}

const highlighted = (name: string) =>
  [...(CSS.highlights.get(name) ?? [])].map(range =>
    (range as Range).toString().replace(/\s+/g, ' ')
  )
const sentenceMark = () => highlighted('enx-active-sentence')
const wordMark = () => highlighted('enx-clicked-word')

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
  openSentencePanel = callback =>
    callback({ success: true, panelOpened: true })
  ;(chrome.runtime as { id?: string }).id = LIVE_ID
  ;(chrome.runtime.sendMessage as jest.Mock).mockImplementation(
    (message: Message, callback?: Callback) => {
      sent.push(message)
      if (!callback) return
      if (message.type === 'openSentencePanel') openSentencePanel(callback)
      else callback(respond(message))
    }
  )
  ;(chrome.storage.local.get as jest.Mock).mockResolvedValue({})
  document.head.innerHTML = ''
  document.body.innerHTML = PAGE
})

afterEach(() => {
  ;(chrome.runtime as { id?: string }).id = undefined
  document.dispatchEvent(new Event(STAND_DOWN_EVENT))
  ;(chrome.runtime as { id?: string }).id = LIVE_ID
  CSS.highlights.clear()
  jest.restoreAllMocks()
})

const HINT = /Click or right-click the Catglish toolbar icon/

describe('sending the sentence from the word popover', () => {
  it('closes the popover once the side panel opened', async () => {
    await enable()
    await clickWord('#one', 'Dashwood')
    expect(popoverWord()).toContain('Dashwood')

    await sendSentence()

    expect(sent.some(m => m.type === 'openSentencePanel')).toBe(true)
    expect(popover()).toBeNull()
  })

  it.each([
    [
      'the panel did not open',
      (callback: Callback) => callback({ success: true, panelOpened: false }),
    ],
    [
      'the request failed',
      (callback: Callback) => callback({ success: false, error: 'boom' }),
    ],
    [
      'sendMessage throws',
      () => {
        throw new Error('Could not establish connection')
      },
    ],
  ])('keeps the popover with the hint when %s', async (_case, reply) => {
    openSentencePanel = reply
    await enable()
    await clickWord('#one', 'Dashwood')

    await sendSentence()

    expect(popoverWord()).toContain('Dashwood')
    expect(hint()).toMatch(HINT)
  })

  it('a late reply for an earlier word leaves the next word’s popover open, without a hint', async () => {
    let replyForA: Callback | null = null
    openSentencePanel = callback => {
      replyForA = callback
    }
    await enable()
    await clickWord('#one', 'Dashwood')
    await sendSentence()
    expect(replyForA).not.toBeNull()

    await clickWord('#one', 'residence')
    expect(popoverWord()).toContain('residence')
    replyForA!({ success: true, panelOpened: true })
    await settle()

    expect(popoverWord()).toContain('residence')
    expect(hint()).toBeNull()
  })
})

describe('the clicked word mark (ADR-085)', () => {
  const SENTENCE =
    'The family of Dashwood had long been settled in Sussex.'

  it('marks only the clicked word next to the sentence highlight', async () => {
    await enable()
    await clickWord('#one', 'Dashwood')

    await sendSentence()

    expect(sentenceMark()).toEqual([SENTENCE])
    expect(wordMark()).toEqual(['Dashwood'])
  })

  it('replaces both marks when another word’s sentence is sent', async () => {
    openSentencePanel = callback =>
      callback({ success: true, panelOpened: false })
    await enable()
    await clickWord('#one', 'Dashwood')
    await sendSentence()

    await clickWord('#one', 'residence')
    await sendSentence()

    expect(sentenceMark()).toHaveLength(1)
    expect(sentenceMark()[0]).toContain('residence')
    expect(wordMark()).toEqual(['residence'])
  })

  it.each([
    ['a click in the page', () => document.body.click()],
    [
      'a key press',
      () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
      },
    ],
    [
      'learning mode turning off',
      async () => {
        await sendToContent({ action: 'enxStop' })
      },
    ],
  ])('clears both marks on %s', async (_case, trigger) => {
    await enable()
    await clickWord('#one', 'Dashwood')
    await sendSentence()
    expect(sentenceMark()).toHaveLength(1)
    expect(wordMark()).toHaveLength(1)

    await trigger()

    expect(sentenceMark()).toEqual([])
    expect(wordMark()).toEqual([])
  })

  it('clears both marks when a fresh script takes over', async () => {
    await enable()
    await clickWord('#one', 'Dashwood')
    await sendSentence()
    expect(wordMark()).toHaveLength(1)

    ;(chrome.runtime as { id?: string }).id = undefined
    document.dispatchEvent(new Event(STAND_DOWN_EVENT))
    ;(chrome.runtime as { id?: string }).id = LIVE_ID

    expect(sentenceMark()).toEqual([])
    expect(wordMark()).toEqual([])
  })
})
