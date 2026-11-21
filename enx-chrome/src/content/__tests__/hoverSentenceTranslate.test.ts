// Hover sentence-translate button wiring (ADR-068 / #550): target resolution,
// page gestures, send/highlight and preference cleanup through the real
// content script.

import { STAND_DOWN_EVENT } from '@/lib/orphanStandDown'
import { HOVER_SENTENCE_HIGHLIGHT_NAME } from '@/lib/wordHighlight'
import { LOOKUP_FAILED_MESSAGE } from '@/lib/extensionContext'
import { WordProcessor } from '@/lib/wordProcessor'

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

// >5000 chars so extractSentenceContext takes the SEGMENT_WINDOW path.
const LONG_PARAGRAPH = `${'Word '.repeat(1200).trim()}.`

const PAGE = `
  <article>
    <h1 id="heading">Sense and Sensibility</h1>
    <p id="one">The family of Dashwood had long been settled in Sussex. Their estate
      was large, and their residence was at Norland Park, in the centre of their property.</p>
    <p id="long">${LONG_PARAGRAPH}</p>
    <p id="two">Another sentence lives here for dismissal tests.</p>
  </article>`

let sent: Message[]
let openSentencePanel: (callback: Callback) => void

const respond = (message: Message): unknown => {
  switch (message.type) {
    case 'getReviewWords':
      return { success: true, reviewWords: [['residence', 1]] }
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

const loadContentScript = async (spa = false) => {
  await jest.isolateModulesAsync(async () => {
    if (spa) {
      const { config } = await import('@/config/env')
      config.rssxOrigins = ['http://localhost']
    }
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
  delete (window as { navigation?: unknown }).navigation
  CSS.highlights.clear()
  jest.useRealTimers()
  jest.restoreAllMocks()
})

const enable = async (spa = false) => {
  const send = await loadContentScript(spa)
  const done = send({ action: 'enxRun' })
  if (spa) await jest.advanceTimersByTimeAsync(150)
  await settle()
  expect(await done).toMatchObject({ success: true })
  await settle()
  return send
}

const changePreference = (name: 'translate' | 'shade', enabled: boolean) => {
  for (const [listener] of (chrome.storage.onChanged.addListener as jest.Mock).mock.calls) {
    listener({ [`enx-hover-sentence-${name}-enabled`]: { newValue: enabled } }, 'local')
  }
}

const queueMove = (selector: string, word: string, x = 5, buttons = 0) => {
  const el = pointAtWord(selector, word)
  el.dispatchEvent(
    new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: 5, buttons })
  )
}

const moveToWord = async (selector: string, word: string, x = 5) => {
  queueMove(selector, word, x)
  // Flush the rAF throttle and any immediate rule timers.
  await jest.advanceTimersByTimeAsync(16)
  await settle()
}

const washRange = (name = HOVER_SENTENCE_HIGHLIGHT_NAME) =>
  [...(CSS.highlights.get(name) ?? [])][0]

const distinctSentenceBoxes = () => {
  jest.spyOn(Range.prototype, 'getClientRects').mockImplementation(function (this: Range) {
    const left = this.startContainer.parentElement?.id === 'two' ? 200 : 0
    return [new DOMRect(left, 0, 100, 30)] as unknown as DOMRectList
  })
}

const advancePastDwell = async () => {
  await jest.advanceTimersByTimeAsync(400)
  await settle()
}

describe('hover sentence translate target resolution', () => {
  it('ignores a release outside the article even with a valid word and rectangle', async () => {
    document.body.insertAdjacentHTML('beforeend', '<aside><p id="sidebar">Sidebar sentence.</p></aside>')
    await enable()
    const target = pointAtWord('#sidebar', 'Sidebar')
    target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 5, clientY: 5 }))
    await advancePastDwell()
    expect(hoverButton()).toBeNull()
  })

  it('resolves the new sentence when scrolling moves it under the old pointer coordinates', async () => {
    let scrolled = false
    jest.spyOn(Range.prototype, 'getClientRects').mockImplementation(function (this: Range) {
      const second = this.startContainer.parentElement?.id === 'two'
      const top = (second ? 100 : 0) - (scrolled ? 100 : 0)
      return [new DOMRect(0, top, 100, 30)] as unknown as DOMRectList
    })
    await enable()
    await moveToWord('#one', 'residence')
    await advancePastDwell()
    expect(washRange()?.toString()).toContain('Their estate')
    scrolled = true
    window.dispatchEvent(new Event('scroll'))
    await moveToWord('#two', 'Another')
    await advancePastDwell()
    expect(washRange()?.toString()).toBe('Another sentence lives here for dismissal tests.')
  })

  it.each(['<a href="/other">Link</a>', '<code>Link</code>'])(
    'preserves exclusions inside a cached sentence containing %s',
    async inline => {
      document.querySelector('#one')!.innerHTML = `Start with ${inline} and finish here.`
      await enable()
      await moveToWord('#one', 'Start')
      await advancePastDwell()
      expect(washRange()?.toString()).toBe('Start with Link and finish here.')
      await moveToWord('#one', 'Link')
      await jest.advanceTimersByTimeAsync(700)
      expect(hoverButton()).toBeNull()
    }
  )

  it('shows no button when a caret exists but expands to no word', async () => {
    document.querySelector('#one')!.textContent = '   …   '
    const text = textHolding('#one', '…')
    await enable()
    ;(
      document as unknown as {
        caretPositionFromPoint: () => unknown
      }
    ).caretPositionFromPoint = () => ({
      offsetNode: text,
      offset: text.data.indexOf('…'),
    })
    document.querySelector('#one')!.dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, clientX: 5, clientY: 5 })
    )
    await advancePastDwell()
    expect(hoverButton()).toBeNull()
    expect(washRange()).toBeUndefined()
  })

  it('rejects a collapsed sentence range even when caret and word resolve', async () => {
    await enable()
    jest.spyOn(Range.prototype, 'collapsed', 'get').mockReturnValue(true)
    await moveToWord('#one', 'residence')
    await advancePastDwell()
    expect(hoverButton()).toBeNull()
  })

  it('shows no hover button for a word with no sentence container', async () => {
    document.querySelector('article')!.insertAdjacentHTML(
      'afterbegin',
      '<span id="byline">Dashwood</span>'
    )
    await enable()
    await moveToWord('#byline', 'Dashwood')
    await advancePastDwell()
    expect(hoverButton()).toBeNull()
    expect(washRange()).toBeUndefined()
  })

  it.each([
    ['empty', []],
    ['zero-size', [new DOMRect()]],
  ])('rejects %s geometry for the sentence Range', async (_name, rects) => {
    jest.spyOn(Range.prototype, 'getClientRects').mockImplementation(function (this: Range) {
      return (this.toString() === 'residence' ? [BOX] : rects) as unknown as DOMRectList
    })
    await enable()
    await moveToWord('#one', 'residence')
    await advancePastDwell()
    expect(hoverButton()).toBeNull()
    expect(washRange()).toBeUndefined()
  })

  it('anchors to the whole paragraph when sentence segmentation fails', async () => {
    await enable()
    jest.spyOn(Intl, 'Segmenter').mockImplementation(() => {
      throw new Error('Sentence segmentation failed')
    })
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    await moveToWord('#one', 'residence')
    await advancePastDwell()
    expect(hoverButton()).not.toBeNull()
    const text = textHolding('#one', 'residence')
    expect(washRange()).toMatchObject({
      startContainer: text,
      startOffset: 0,
      endContainer: text,
      endOffset: text.length,
    })
    expect(washRange()?.toString()).toBe(text.data)
  })

  it('anchors a heading to the whole heading text and Range', async () => {
    await enable()
    await moveToWord('#heading', 'Sense')
    await advancePastDwell()
    expect(hoverButton()).not.toBeNull()
    const wash = washRange()
    expect(wash?.toString()).toBe('Sense and Sensibility')
    expect(wash?.startContainer).toBe(textHolding('#heading', 'Sense'))
    expect(wash?.endContainer).toBe(textHolding('#heading', 'Sense'))
  })

  it('resolves a >5000-character paragraph through the window fallback', async () => {
    expect(LONG_PARAGRAPH.length).toBeGreaterThan(5000)
    await enable()
    await moveToWord('#long', 'Word')
    await advancePastDwell()
    expect(hoverButton()).not.toBeNull()
    const range = washRange()
    const wash = range?.toString() ?? ''
    const text = textHolding('#long', 'Word')
    expect(range).toMatchObject({
      startContainer: text,
      startOffset: 0,
      endContainer: text,
      endOffset: WordProcessor.SEGMENT_WINDOW_RADIUS - 1,
    })
    expect(wash.length).toBeGreaterThan(0)
    expect(wash.length).toBeLessThan(LONG_PARAGRAPH.length)
    expect(wash.length).toBeLessThanOrEqual(WordProcessor.SEGMENT_WINDOW_RADIUS)
  })
})

describe('hover sentence translate gestures', () => {
  const leaveArticle = () =>
    document.querySelector('article')!.dispatchEvent(new MouseEvent('mouseleave'))

  it('cancels a queued pointer sample when the reader presses before the frame', async () => {
    await enable()
    queueMove('#one', 'residence')
    document.querySelector('#one')!.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, clientX: 5, clientY: 5, buttons: 1 })
    )
    jest.advanceTimersToNextFrame()
    await advancePastDwell()
    expect(hoverButton()).toBeNull()
    expect(washRange()).toBeUndefined()
  })

  it('resumes hover after releasing a word popover control', async () => {
    await enable()
    const word = pointAtWord('#one', 'residence')
    word.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 5, clientY: 5 }))
    await settle()
    const control = document.querySelector('.enx-anchored-overlay')!
      .shadowRoot!.querySelector('button')!
    control.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true, buttons: 1 }))
    control.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, composed: true }))
    await moveToWord('#one', 'residence')
    await advancePastDwell()
    expect(hoverButton()).not.toBeNull()
  })

  it.each(['selection', 'held button'])('reads a live %s when hover is enabled', async gesture => {
    await enable()
    changePreference('translate', false)
    const selection = window.getSelection()!
    if (gesture === 'selection') {
      const range = document.createRange()
      range.selectNodeContents(document.querySelector('#one')!)
      selection.addRange(range)
    }
    changePreference('translate', true)
    queueMove('#one', 'residence', 5, gesture === 'held button' ? 1 : 0)
    await advancePastDwell()
    await advancePastDwell()
    expect(hoverButton()).toBeNull()
    selection.removeAllRanges()
    await moveToWord('#one', 'residence')
    await advancePastDwell()
    expect(hoverButton()).not.toBeNull()
  })

  it('Escape dismisses the latest pointer target before its frame runs', async () => {
    distinctSentenceBoxes()
    await enable()
    await moveToWord('#one', 'residence')
    await advancePastDwell()
    expect(hoverButton()).not.toBeNull()
    queueMove('#two', 'Another', 205)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await advancePastDwell()
    await moveToWord('#two', 'Another', 205)
    await advancePastDwell()
    expect(hoverButton()).toBeNull()
    expect(washRange()).toBeUndefined()
  })

  it('shows at the original dwell deadline after moving within the sentence at 390 ms', async () => {
    await enable()
    queueMove('#one', 'residence')
    jest.advanceTimersToNextFrame()
    await jest.advanceTimersByTimeAsync(374)
    queueMove('#one', 'estate')
    await jest.advanceTimersByTimeAsync(16)
    expect(hoverButton()).toBeNull()
    await jest.advanceTimersByTimeAsync(10)
    expect(hoverButton()).not.toBeNull()
  })

  it('restarts grace on leaving the button after the previous timers have run', async () => {
    await enable()
    await moveToWord('#one', 'residence')
    await advancePastDwell()
    const button = hoverButton()!.shadowRoot!.querySelector('button')!
    leaveArticle()
    button.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, composed: true }))
    await jest.advanceTimersByTimeAsync(1300)
    expect(hoverButton()).not.toBeNull()
    button.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, composed: true }))
    await jest.advanceTimersByTimeAsync(699)
    expect(hoverButton()).not.toBeNull()
    await jest.advanceTimersByTimeAsync(1)
    expect(hoverButton()).toBeNull()
  })

  it.each(['completes', 'abandons before', 'abandons after'])(
    'handles a late switch that %s the original grace deadline',
    async outcome => {
      distinctSentenceBoxes()
      await enable()
      await moveToWord('#one', 'residence')
      await advancePastDwell()
      const original = hoverButton()
      leaveArticle()
      await jest.advanceTimersByTimeAsync(550)
      await moveToWord('#two', 'Another', 205)
      expect(hoverButton()).toBe(original)
      if (outcome === 'abandons before') leaveArticle()
      await jest.advanceTimersByTimeAsync(150)
      if (outcome === 'abandons before') {
        expect(hoverButton()).toBeNull()
        await advancePastDwell()
        expect(hoverButton()).toBeNull()
        return
      }
      expect(hoverButton()).toBe(original)
      if (outcome === 'abandons after') {
        leaveArticle()
        expect(hoverButton()).toBeNull()
      }
      await advancePastDwell()
      expect(washRange()?.toString()).toBe(
        outcome === 'completes' ? 'Another sentence lives here for dismissal tests.' : undefined
      )
    }
  )

  it('keeps the original button and wash until the next sentence dwells', async () => {
    distinctSentenceBoxes()
    await enable()
    await moveToWord('#one', 'residence')
    await advancePastDwell()
    const original = hoverButton()
    expect(original).not.toBeNull()
    expect(washRange()?.toString()).toContain('Their estate')

    await moveToWord('#two', 'Another', 205)
    expect(hoverButton()).toBe(original)
    expect(washRange()?.toString()).toContain('Their estate')
    await advancePastDwell()
    expect(hoverButton()).not.toBe(original)
    expect(washRange()?.toString()).toBe('Another sentence lives here for dismissal tests.')
  })
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

    // Start grace so a hide deadline is armed before the drag begins.
    leaveArticle()
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
  const SECOND_SENTENCE =
    'Their estate was large, and their residence was at Norland Park, in the centre of their property.'

  const clickHoverButton = async () => {
    const overlay = hoverButton()!
    const button = overlay.shadowRoot!.querySelector('button')!
    button.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, composed: true })
    )
    button.dispatchEvent(
      new MouseEvent('mouseup', { bubbles: true, composed: true })
    )
    button.click()
    await settle()
  }

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
      sentence: SECOND_SENTENCE,
      wordStates: {
        residence: expect.objectContaining({ English: 'residence' }),
      },
    })
    expect(sent.filter(m => m.type === 'getOneWord')).toHaveLength(0)
    expect(sent.some(m => m.type === 'recordReadingPosition')).toBe(true)
    const active = [...(CSS.highlights.get('enx-active-sentence') ?? [])][0]
    expect(active?.toString().replace(/\s+/g, ' ').trim()).toBe(SECOND_SENTENCE)
    expect(CSS.highlights.has(HOVER_SENTENCE_HIGHLIGHT_NAME)).toBe(false)
    expect(CSS.highlights.has('enx-clicked-word')).toBe(false)
    expect(hoverButton()).toBeNull()
    expect(hintText()).toBeNull()

    await moveToWord('#one', 'residence')
    await advancePastDwell()
    expect(hoverButton()).toBeNull()
  })

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

  it.each([
    'word click',
    'selection button',
    'selection hint',
    'sentence translation',
    'phrase lookup',
    'account change',
    'article teardown',
  ])(
    'ignores a delayed panel reply after a newer %s',
    async cause => {
      let finish: (response: unknown) => void = () => {}
      openSentencePanel = callback => {
        finish = callback
      }
      const send = await enable()
      await moveToWord('#one', 'residence')
      await advancePastDwell()
      await clickHoverButton()

      let newerButton: Element | null = null
      if (cause === 'word click') {
        const word = pointAtWord('#two', 'Another')
        word.dispatchEvent(
          new MouseEvent('click', { bubbles: true, clientX: 5, clientY: 5 })
        )
        await settle()
        expect(
          document
            .querySelector('.enx-anchored-overlay')
            ?.shadowRoot?.textContent
        ).toMatch(/Another/i)
      } else if (cause === 'account change') {
        await send({ action: 'sessionExpired', cause: 'signed-out' })
        await settle()
      } else if (cause === 'article teardown') {
        await send({ action: 'enxStop' })
        await settle()
      } else {
        const paragraph = document.querySelector(cause === 'selection hint' ? '#long' : '#two')!
        const range = document.createRange()
        if (cause === 'phrase lookup') {
          const text = textHolding('#two', 'Another')
          range.setStart(text, 0)
          range.setEnd(text, 'Another sentence'.length)
        } else {
          range.selectNodeContents(paragraph)
        }
        const selection = window.getSelection()!
        selection.removeAllRanges()
        selection.addRange(range)
        paragraph.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
        await settle()
        if (cause === 'selection hint') {
          expect(hintText()).toMatch(/Selection is too long/i)
        } else {
          newerButton = selectionButton()
          expect(newerButton).not.toBeNull()
          if (cause === 'sentence translation' || cause === 'phrase lookup') {
            openSentencePanel = callback => callback({ success: true, panelOpened: true })
            newerButton!.shadowRoot!.querySelector('button')!.click()
            await settle()
            const requests = sent.filter(message => message.type === 'openSentencePanel')
            expect(requests).toHaveLength(2)
            expect(requests[1]).toMatchObject(
              cause === 'phrase lookup'
                ? { phrase: 'Another sentence' }
                : { sentence: paragraph.textContent }
            )
          }
        }
      }

      finish({ success: false })
      await settle()
      if (cause === 'word click') {
        expect(hintText()).not.toContain(LOOKUP_FAILED_MESSAGE)
        expect(
          document
            .querySelector('.enx-anchored-overlay')
            ?.shadowRoot?.textContent
        ).toMatch(/Another/i)
      } else if (cause === 'selection hint') {
        expect(hintText()).toMatch(/Selection is too long/i)
      } else {
        expect(hintText()).toBeNull()
        if (cause === 'selection button') expect(selectionButton()).toBe(newerButton)
      }
    }
  )
})

describe('hover sentence translate preferences and cleanup', () => {
  it('turning the main switch off removes a visible button without reload', async () => {
    await enable()
    await moveToWord('#one', 'residence')
    await advancePastDwell()
    expect(hoverButton()).not.toBeNull()
    changePreference('translate', false)
    expect(hoverButton()).toBeNull()
  })

  it('cancels a pending dwell when translate is switched off then on', async () => {
    await enable()
    queueMove('#one', 'residence')
    await jest.advanceTimersByTimeAsync(16)
    changePreference('translate', false)
    expect(hoverButton()).toBeNull()
    changePreference('translate', true)
    await advancePastDwell()
    expect(hoverButton()).toBeNull()
    await moveToWord('#one', 'residence')
    await advancePastDwell()
    expect(hoverButton()).not.toBeNull()
  })

  it('toggles the live wash while the same button stays mounted', async () => {
    await enable()
    await moveToWord('#one', 'residence')
    await advancePastDwell()
    const button = hoverButton()
    expect(button).not.toBeNull()
    expect(washRange()?.toString()).toContain('residence')
    changePreference('shade', false)
    expect(hoverButton()).toBe(button)
    expect(washRange()).toBeUndefined()
    changePreference('shade', true)
    expect(hoverButton()).toBe(button)
    expect(washRange()?.toString()).toContain('residence')
  })

  it('cancels a pending pointer frame when learning mode is disabled', async () => {
    const send = await enable()
    queueMove('#one', 'residence')
    await send({ action: 'enxStop' })
    await advancePastDwell()
    expect(hoverButton()).toBeNull()
    expect(washRange()).toBeUndefined()
  })

  const enableSpa = async () => {
    const navigation = new EventTarget()
    ;(window as { navigation?: unknown }).navigation = navigation
    await enable(true)
    return (url: string) =>
      navigation.dispatchEvent(Object.assign(new Event('navigate'), {
        destination: { url },
        navigationType: 'push',
        hashChange: false,
        downloadRequest: null,
      }))
  }

  it('cancels a running dwell when SPA navigation tears down the article', async () => {
    const navigate = await enableSpa()
    await moveToWord('#one', 'residence')
    expect(hoverButton()).toBeNull()

    navigate('https://x.com/home')
    await advancePastDwell()
    expect(hoverButton()).toBeNull()
    expect(washRange()).toBeUndefined()

    await moveToWord('#one', 'residence')
    await advancePastDwell()
    expect(hoverButton()).toBeNull()
  })

  it('discards the old dwell when SPA navigation replaces the article roots', async () => {
    const navigate = await enableSpa()
    await moveToWord('#one', 'residence')
    expect(hoverButton()).toBeNull()

    navigate('http://localhost/?article=2')
    document.body.innerHTML = `
      <article>
        <p id="one">Replacement sentence occupies the prior coordinates.</p>
      </article>`
    await jest.advanceTimersByTimeAsync(150)
    await advancePastDwell()
    expect(hoverButton()).toBeNull()
    expect(washRange()).toBeUndefined()

    await moveToWord('#one', 'Replacement')
    await advancePastDwell()
    expect(hoverButton()).not.toBeNull()
    expect(washRange()?.toString()).toBe(
      'Replacement sentence occupies the prior coordinates.'
    )
  })

  it('stand-down leaves no stale button or wash after timers and rAF', async () => {
    await enable()
    queueMove('#one', 'residence')
    // Teardown while the frame/dwell is still pending — do not flush first.
    ;(chrome.runtime as { id?: string }).id = undefined
    document.dispatchEvent(new Event(STAND_DOWN_EVENT))
    ;(chrome.runtime as { id?: string }).id = LIVE_ID

    await jest.advanceTimersByTimeAsync(1000)
    await jest.runOnlyPendingTimersAsync()
    expect(hoverButton()).toBeNull()
    expect(CSS.highlights.has(HOVER_SENTENCE_HIGHLIGHT_NAME)).toBe(false)
  })
})
