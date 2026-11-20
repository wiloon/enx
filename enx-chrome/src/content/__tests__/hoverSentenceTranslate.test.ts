// Hover sentence-translate button wiring (ADR-068 / #550): target resolution,
// page gestures, send/highlight and preference cleanup through the real
// content script.

import { STAND_DOWN_EVENT } from '@/lib/orphanStandDown'
import { HOVER_SENTENCE_HIGHLIGHT_NAME } from '@/lib/wordHighlight'
import { LOOKUP_FAILED_MESSAGE } from '@/lib/extensionContext'

jest.mock('@/config/env')

type Message = {
  type?: string
  action?: string
  word?: string
  sentence?: string
  wordStates?: unknown
}

type Callback = (response: unknown) => void

const LIVE_ID = 'abcdefghijklmnopqrstuvwxyzabcdef'

const PAGE = `
  <article>
    <h1 id="heading">Sense and Sensibility</h1>
    <p id="one">The family of Dashwood had long been settled in Sussex. Their estate
      was large, and their residence was at Norland Park, in the centre of their property.</p>
    <p id="long">${'Word '.repeat(90).trim()}.</p>
    <p id="two">Another sentence lives here for dismissal tests.</p>
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
    case 'openSentencePanel':
      return new Promise(resolve => {
        openSentencePanel(resolve as Callback)
      })
    default:
      return { success: true }
  }
}

const settle = async () => {
  for (let i = 0; i < 20; i++) await jest.advanceTimersByTimeAsync(1)
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

const pointAtWord = (selector: string, word: string) => {
  const text = textHolding(selector, word)
  const offset = text.data.indexOf(word) + 1
  ;(
    document as unknown as {
      caretPositionFromPoint: (x: number, y: number) => unknown
    }
  ).caretPositionFromPoint = () => ({ offsetNode: text, offset })
  return text.parentElement!
}

const hoverButton = () =>
  document.querySelector('.enx-hover-sentence-translate-button')

const selectionButton = () =>
  document.querySelector('.enx-selection-translate-button')

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

const popoverProto = HTMLElement.prototype as HTMLElement & {
  showPopover?: () => void
  hidePopover?: () => void
}
popoverProto.showPopover ??= () => {}
popoverProto.hidePopover ??= () => {}

beforeAll(() => {
  Range.prototype.getClientRects = () => [BOX] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => BOX as DOMRect
})

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'debug').mockImplementation(() => {})
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] })
  sent = []
  openSentencePanel = callback =>
    callback({ success: true, panelOpened: true })
  ;(chrome.runtime as { id?: string }).id = LIVE_ID
  ;(chrome.runtime.sendMessage as jest.Mock).mockImplementation(
    (message: Message, callback?: (response: unknown) => void) => {
      sent.push(message)
      const result = respond(message)
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        ;(result as Promise<unknown>).then(r => callback?.(r))
      } else if (callback) {
        callback(result)
      }
    }
  )
  ;(chrome.storage.local.get as jest.Mock).mockResolvedValue({})
  document.head.innerHTML = ''
  document.body.innerHTML = PAGE
  CSS.highlights.clear()
})

afterEach(() => {
  ;(chrome.runtime as { id?: string }).id = undefined
  document.dispatchEvent(new Event(STAND_DOWN_EVENT))
  ;(chrome.runtime as { id?: string }).id = LIVE_ID
  CSS.highlights.clear()
  jest.useRealTimers()
  jest.restoreAllMocks()
})

const enable = async () => {
  const send = await loadContentScript()
  const done = send({ action: 'enxRun' })
  await settle()
  expect(await done).toMatchObject({ success: true })
  await settle()
}

const moveToWord = async (selector: string, word: string) => {
  const el = pointAtWord(selector, word)
  el.dispatchEvent(
    new MouseEvent('mousemove', { bubbles: true, clientX: 5, clientY: 5 })
  )
  // Flush the rAF throttle and any immediate rule timers.
  await jest.advanceTimersByTimeAsync(16)
  await settle()
}

const advancePastDwell = async () => {
  await jest.advanceTimersByTimeAsync(400)
  await settle()
}

describe('hover sentence translate target resolution', () => {
  it('shows no button when the caret has no word context', async () => {
    await enable()
    ;(
      document as unknown as {
        caretPositionFromPoint: () => null
      }
    ).caretPositionFromPoint = () => null
    document.querySelector('article')!.dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, clientX: 5, clientY: 5 })
    )
    await advancePastDwell()
    expect(hoverButton()).toBeNull()
  })

  it('anchors a heading to the whole heading text', async () => {
    await enable()
    await moveToWord('#heading', 'Sense')
    await advancePastDwell()
    expect(hoverButton()).not.toBeNull()
    expect(CSS.highlights.has(HOVER_SENTENCE_HIGHLIGHT_NAME)).toBe(true)
  })

  it('resolves a long paragraph beyond 80 words via the window fallback', async () => {
    await enable()
    await moveToWord('#long', 'Word')
    await advancePastDwell()
    expect(hoverButton()).not.toBeNull()
  })
})

describe('hover sentence translate gestures', () => {
  it('hides on mousedown, still looks up a word click, then can reappear after 400 ms without mousemove', async () => {
    await enable()
    await moveToWord('#one', 'residence')
    await advancePastDwell()
    expect(hoverButton()).not.toBeNull()

    const el = pointAtWord('#one', 'residence')
    el.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, clientX: 5, clientY: 5 })
    )
    expect(hoverButton()).toBeNull()

    el.dispatchEvent(
      new MouseEvent('mouseup', { bubbles: true, clientX: 5, clientY: 5 })
    )
    el.dispatchEvent(
      new MouseEvent('click', { bubbles: true, clientX: 5, clientY: 5 })
    )
    await settle()
    expect(sent.some(m => m.type === 'getOneWord')).toBe(true)
    expect(document.querySelector('.enx-anchored-overlay')).not.toBeNull()

    await advancePastDwell()
    expect(hoverButton()).not.toBeNull()
  })

  it('keeps the selection translate button when a pending hover hide expires during a drag', async () => {
    await enable()
    await moveToWord('#one', 'residence')
    await advancePastDwell()
    expect(hoverButton()).not.toBeNull()

    const start = textHolding('#one', 'Their estate')
    const end = textHolding('#one', 'Norland Park')
    const range = document.createRange()
    range.setStart(start, start.data.indexOf('Their estate'))
    range.setEnd(end, end.data.indexOf('Norland Park') + 'Norland Park'.length)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)

    end.parentElement!.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, clientX: 5, clientY: 5 })
    )
    expect(hoverButton()).toBeNull()
    end.parentElement!.dispatchEvent(
      new MouseEvent('mouseup', { bubbles: true, clientX: 5, clientY: 5 })
    )
    await settle()
    expect(selectionButton()).not.toBeNull()

    await jest.advanceTimersByTimeAsync(700)
    expect(selectionButton()).not.toBeNull()
  })

  it('Escape removes a visible button and cancels a pending dwell', async () => {
    await enable()
    await moveToWord('#one', 'residence')
    await advancePastDwell()
    expect(hoverButton()).not.toBeNull()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(hoverButton()).toBeNull()
    expect(CSS.highlights.has(HOVER_SENTENCE_HIGHLIGHT_NAME)).toBe(false)

    await moveToWord('#one', 'residence')
    await advancePastDwell()
    expect(hoverButton()).toBeNull()
  })

  it('a word click in a dismissed sentence still looks up and leaves hover hidden', async () => {
    await enable()
    await moveToWord('#one', 'residence')
    await advancePastDwell()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

    const el = pointAtWord('#one', 'residence')
    el.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, clientX: 5, clientY: 5 })
    )
    el.dispatchEvent(
      new MouseEvent('mouseup', { bubbles: true, clientX: 5, clientY: 5 })
    )
    el.dispatchEvent(
      new MouseEvent('click', { bubbles: true, clientX: 5, clientY: 5 })
    )
    await settle()
    expect(sent.some(m => m.type === 'getOneWord')).toBe(true)

    await advancePastDwell()
    expect(hoverButton()).toBeNull()
  })
})

describe('hover sentence translate send and highlight', () => {
  const clickHoverButton = async () => {
    const overlay = hoverButton()!
    const button = overlay.shadowRoot!.querySelector('button')!
    button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    button.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    button.click()
    await settle()
  }

  it('sends openSentencePanel with empty word, records position, clears hover wash and paints the active sentence', async () => {
    await enable()
    await moveToWord('#one', 'residence')
    await advancePastDwell()

    const clicked = document.createRange()
    const tw = textHolding('#one', 'residence')
    clicked.setStart(tw, tw.data.indexOf('residence'))
    clicked.setEnd(tw, tw.data.indexOf('residence') + 'residence'.length)
    CSS.highlights.set('enx-clicked-word', new Highlight(clicked))

    await clickHoverButton()

    const panels = sent.filter(m => m.type === 'openSentencePanel')
    expect(panels).toHaveLength(1)
    expect(panels[0]).toMatchObject({
      word: '',
      sentence: expect.stringContaining('residence'),
    })
    expect(sent.filter(m => m.type === 'getOneWord')).toHaveLength(0)
    expect(sent.some(m => m.type === 'recordReadingPosition')).toBe(true)
    expect(CSS.highlights.has(HOVER_SENTENCE_HIGHLIGHT_NAME)).toBe(false)
    expect(CSS.highlights.has('enx-active-sentence')).toBe(true)
    expect(CSS.highlights.has('enx-clicked-word')).toBe(false)
    expect(hoverButton()).toBeNull()

    await moveToWord('#one', 'residence')
    await advancePastDwell()
    expect(hoverButton()).toBeNull()
  })

  const hintText = () => {
    const overlay = document.querySelector('.enx-anchored-overlay')
    return (
      overlay?.shadowRoot?.querySelector(
        '[data-testid="word-popover-sentence-panel-hint"]'
      )?.textContent ??
      overlay?.shadowRoot?.textContent ??
      null
    )
  }

  it('shows the toolbar hint when the panel did not open', async () => {
    openSentencePanel = callback =>
      callback({ success: true, panelOpened: false })
    await enable()
    await moveToWord('#one', 'residence')
    await advancePastDwell()
    await clickHoverButton()
    expect(hintText()).toMatch(/toolbar icon/i)
  })

  it('shows the retry hint when openSentencePanel fails', async () => {
    openSentencePanel = callback => callback({ success: false })
    await enable()
    await moveToWord('#one', 'residence')
    await advancePastDwell()
    await clickHoverButton()
    expect(hintText()).toContain(LOOKUP_FAILED_MESSAGE)
  })
})

describe('hover sentence translate preferences and cleanup', () => {
  it('turning the main switch off removes a visible button without reload', async () => {
    await enable()
    await moveToWord('#one', 'residence')
    await advancePastDwell()
    expect(hoverButton()).not.toBeNull()

    const listener = (chrome.storage.onChanged.addListener as jest.Mock).mock
      .calls.map(c => c[0])
      .find((fn: (changes: unknown, area: string) => void) => {
        try {
          fn(
            {
              'enx-hover-sentence-translate-enabled': {
                newValue: false,
              },
            },
            'local'
          )
          return true
        } catch {
          return false
        }
      })
    expect(listener).toBeTruthy()
    // Fire for every registered listener (word highlight + hover keys).
    for (const call of (chrome.storage.onChanged.addListener as jest.Mock).mock
      .calls) {
      call[0](
        {
          'enx-hover-sentence-translate-enabled': { newValue: false },
        },
        'local'
      )
    }
    expect(hoverButton()).toBeNull()
  })

  it('stand-down leaves no stale button or wash after timers and rAF', async () => {
    await enable()
    await moveToWord('#one', 'residence')
    await advancePastDwell()
    expect(hoverButton()).not.toBeNull()

    ;(chrome.runtime as { id?: string }).id = undefined
    document.dispatchEvent(new Event(STAND_DOWN_EVENT))
    ;(chrome.runtime as { id?: string }).id = LIVE_ID

    await jest.advanceTimersByTimeAsync(1000)
    await jest.runOnlyPendingTimersAsync()
    expect(hoverButton()).toBeNull()
    expect(CSS.highlights.has(HOVER_SENTENCE_HIGHLIGHT_NAME)).toBe(false)
  })
})
