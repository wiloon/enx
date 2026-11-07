// #563 (adr-034 amendment): short pages whose article node is short, or that
// have none at all, still enable. A page no selector recognises is the whole
// page: selection lookup only, no click lookup, highlights or reading
// (adr-034, 2026-11-07). These tests load the real content script against a
// jsdom page and a fake background.

import { STAND_DOWN_EVENT } from '@/lib/orphanStandDown'
import { IDLE_FLUSH_MS } from '@/content/readingTracker'
import { showAllObserved } from '@/test/fakeIntersectionObserver'

jest.mock('@/config/env')

type Message = { type?: string; action?: string; sentence?: string }
type Callback = (response: unknown) => void

const LIVE_ID = 'abcdefghijklmnopqrstuvwxyzabcdef'

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
      return {
        success: true,
        reviewWords: [
          ['fox', 1],
          ['dog', 1],
          ['conrad', 1],
        ],
      }
    case 'getOneWord':
      return { success: true, ecp: ECP(message.word ?? 'fox') }
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

type Send = (request: unknown) => Promise<Record<string, unknown>>

const loadContentScript = async (rssxOrigins: string[] = []): Promise<Send> => {
  await jest.isolateModulesAsync(async () => {
    const { config } = await import('@/config/env')
    Object.assign(config, { rssxOrigins })
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

const overlays = () => document.querySelectorAll('#enx-anchored-overlay')
const closeOverlays = () => overlays().forEach(overlay => overlay.remove())

// The first text node under `selector` holding `word`.
const textHolding = (selector: string, word: string): Text => {
  const walker = document.createTreeWalker(
    document.querySelector(selector)!,
    NodeFilter.SHOW_TEXT
  )
  let node: Node | null
  while ((node = walker.nextNode())) {
    if ((node as Text).data.includes(word)) return node as Text
  }
  throw new Error(`no text "${word}" under ${selector}`)
}

// jsdom has no layout: resolve the click to `word` and give every Range a
// box that contains the click.
const clickWord = async (selector: string, word: string, wait = settle) => {
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
  await wait()
}

// Selects `text` under `selector` and releases the mouse on its element.
const selectText = async (selector: string, text: string) => {
  const node = textHolding(selector, text)
  const start = node.data.indexOf(text)
  const range = document.createRange()
  range.setStart(node, start)
  range.setEnd(node, start + text.length)
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
  node.parentElement!.dispatchEvent(
    new MouseEvent('mouseup', { bubbles: true })
  )
  await settle()
}

const selectionButtons = () =>
  document.querySelectorAll('.enx-selection-translate-button')

const popoverWord = () =>
  overlays()[0]?.shadowRoot?.querySelector(
    '[data-testid="word-popover-header"]'
  )?.textContent

// Every underlined word, across review buckets.
const underlined = (): string[] => {
  const out: string[] = []
  for (const [name, highlight] of CSS.highlights) {
    if (!name.startsWith('enx-hl-')) continue
    for (const range of highlight as unknown as Iterable<Range>) {
      out.push(range.toString())
    }
  }
  return out
}

// Every element reads as half scrolled past, so a live reading session would
// credit words on its first scroll note; jsdom's zero-height boxes never do.
const giveElementsABox = () =>
  jest
    .spyOn(Element.prototype, 'getBoundingClientRect')
    .mockReturnValue({ ...BOX, top: -500 } as DOMRect)

const progressReports = () =>
  sent.filter(m => m.type === 'reportReadingProgress')

// English prose exactly `length` characters long.
const prose = (length: number) => {
  const sentence = 'The reader turns another page of the long story. '
  return sentence.repeat(Math.ceil(length / sentence.length)).slice(0, length)
}

const TITLE_PAGE = `
  <header><nav><ul><li><a href="/">Standard Ebooks</a></li><li><a href="/ebooks">Ebooks</a></li></ul></nav></header>
  <main>
    <section id="titlepage">
      <h1>Short Fiction</h1>
      <p>By <b>Joseph Conrad</b>.</p>
    </section>
  </main>
  <footer><a href="/about">About</a></footer>`

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
    (message: Message, callback?: Callback) => {
      sent.push(message)
      if (callback) callback(respond(message))
    }
  )
  ;(chrome.storage.local.get as jest.Mock).mockResolvedValue({})
  document.head.innerHTML = ''
  document.body.innerHTML = ''
})

afterEach(() => {
  // Every script loaded so far stands down, so none leaks into the next test.
  ;(chrome.runtime as { id?: string }).id = undefined
  document.dispatchEvent(new Event(STAND_DOWN_EVENT))
  ;(chrome.runtime as { id?: string }).id = LIVE_ID
  CSS.highlights.clear()
  jest.useRealTimers()
  jest.restoreAllMocks()
})

// adr-034 2026-11-07: InfoQ's homepage has no .article__data; its Trending
// tabs are <li aria-selected> with no role, switched by a document listener.
const INFOQ_HOME = `
  <main>
    <div class="tab__switcher">
      <ul>
        <li aria-selected="true">1 week</li>
        <li id="month" aria-selected="false">1 month</li>
        <li aria-selected="false">6 months</li>
      </ul>
    </div>
    <section><p>The quick brown fox jumps over the lazy dog. ${prose(800)}</p></section>
  </main>`

describe('the InfoQ homepage (whole page)', () => {
  it('a click on a Trending tab opens no popover and reaches the page', async () => {
    document.body.innerHTML = INFOQ_HOME
    const pageClicks: MouseEvent[] = []
    const onDocumentClick = (event: MouseEvent) => pageClicks.push(event)
    document.addEventListener('click', onDocumentClick)
    const send = await loadContentScript()
    expect(await send({ action: 'enxRun' })).toMatchObject({ success: true })

    await clickWord('#month', 'month')
    document.removeEventListener('click', onDocumentClick)

    expect(overlays()).toHaveLength(0)
    expect(pageClicks).toHaveLength(1)
    expect(pageClicks[0].defaultPrevented).toBe(false)
  })
})

describe('a Standard Ebooks title page (whole page)', () => {
  beforeEach(() => {
    document.body.innerHTML = TITLE_PAGE
  })

  it('enables, and both the heading and the byline can be looked up by selection', async () => {
    const send = await loadContentScript()

    expect(await send({ action: 'enxRun' })).toMatchObject({ success: true })

    await selectText('h1', 'Fiction')
    expect(popoverWord()).toContain('Fiction')
    closeOverlays()
    await selectText('b', 'Conrad')
    expect(popoverWord()).toContain('Conrad')
  })

  it('a single click on a word opens no popover', async () => {
    const send = await loadContentScript()
    expect(await send({ action: 'enxRun' })).toMatchObject({ success: true })

    await clickWord('b', 'Conrad')

    expect(overlays()).toHaveLength(0)
  })

  it('paints no highlight on a review word', async () => {
    const send = await loadContentScript()
    expect(await send({ action: 'enxRun' })).toMatchObject({ success: true })
    showAllObserved()

    expect(underlined()).toEqual([])
  })

  it('counts no reading', async () => {
    giveElementsABox()
    const send = await loadContentScript()
    expect(await send({ action: 'enxRun' })).toMatchObject({ success: true })
    await clickWord('b', 'Conrad')
    window.dispatchEvent(new Event('pagehide'))

    expect(progressReports()).toEqual([])
  })

  it('sends "By Joseph Conrad." as the sentence of a selected Conrad', async () => {
    const send = await loadContentScript()
    await send({ action: 'enxRun' })
    await selectText('b', 'Conrad')

    const button = overlays()[0].shadowRoot!.querySelector(
      '[data-testid="word-popover-sentence-translation"]'
    ) as HTMLButtonElement
    button.click()
    await settle()

    expect(sent.find(m => m.type === 'openSentencePanel')?.sentence).toBe(
      'By Joseph Conrad.'
    )
  })
})

describe('a whole-page lookup area', () => {
  it('fails with no-words when every word is inside a link', async () => {
    document.body.innerHTML = `<nav><a href="/a">Home page</a> <a href="/b">About us</a></nav>`
    const send = await loadContentScript()

    expect(await send({ action: 'enxRun' })).toMatchObject({
      success: false,
      reason: 'no-words',
    })
  })

  it('fails with no-words when every word sits in an interactive role', async () => {
    document.body.innerHTML = `<div role="button"><p>Hello fox world.</p></div>`
    const send = await loadContentScript()

    expect(await send({ action: 'enxRun' })).toMatchObject({
      success: false,
      reason: 'no-words',
    })
  })

  it('looks words up but counts no reading', async () => {
    document.body.innerHTML = `<div><p id="short">The quick brown fox jumps over the lazy dog.</p></div>`
    giveElementsABox()
    const send = await loadContentScript()

    expect(await send({ action: 'enxRun' })).toMatchObject({ success: true })
    await selectText('#short', 'dog')
    expect(overlays()).toHaveLength(1)
    window.dispatchEvent(new Event('pagehide'))

    expect(progressReports()).toEqual([])
  })

  it('paragraphs directly under body are whole page and count no reading', async () => {
    document.body.innerHTML = `<p id="long">The quick brown fox jumps over the lazy dog. ${prose(600)}</p>`
    giveElementsABox()
    const send = await loadContentScript()

    expect(await send({ action: 'enxRun' })).toMatchObject({ success: true })
    await clickWord('#long', 'dog')
    expect(overlays()).toHaveLength(0)
    await selectText('#long', 'dog')
    expect(overlays()).toHaveLength(1)
    window.dispatchEvent(new Event('pagehide'))

    expect(progressReports()).toEqual([])
  })

  it('reports the article read before it once, then nothing from clicks, scrolls or timers', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] })
    const tick = async () => {
      for (let i = 0; i < 10; i++) await jest.advanceTimersByTimeAsync(1)
    }
    document.body.innerHTML =
      `<article><p id="lead">The quick brown fox jumps over the lazy dog.</p>` +
      `<p id="rest">${prose(600)}</p></article>`
    const send = await loadContentScript()
    const enabled = send({ action: 'enxRun' })
    await tick()
    expect(await enabled).toMatchObject({ success: true })
    await clickWord('#lead', 'dog', tick)
    const stopped = send({ action: 'enxStop' })
    await tick()
    await stopped
    expect(progressReports()).toEqual([])

    // The next page no selector recognises.
    document.body.innerHTML = `<div><p id="lead">The quick brown fox jumps over the lazy dog.</p></div>`
    const reenabled = send({ action: 'enxRun' })
    await tick()
    expect(await reenabled).toMatchObject({ success: true })
    expect(progressReports()).toHaveLength(1)

    await clickWord('#lead', 'fox', tick)
    window.dispatchEvent(new Event('scroll'))
    window.dispatchEvent(new Event('pagehide'))
    document.dispatchEvent(new Event('visibilitychange'))
    await jest.advanceTimersByTimeAsync(IDLE_FLUSH_MS * 2)

    expect(progressReports()).toHaveLength(1)
  })
})

describe('an article a selector recognises', () => {
  beforeEach(() => {
    document.body.innerHTML = `<main><article><p id="a">The quick brown fox jumps over the lazy dog. ${prose(600)}</p></article></main>`
  })

  it('a click on a word opens its popover', async () => {
    const send = await loadContentScript()
    await send({ action: 'enxRun' })

    await clickWord('#a', 'dog')

    expect(popoverWord()).toContain('dog')
  })

  it('paints review words', async () => {
    const send = await loadContentScript()
    await send({ action: 'enxRun' })
    showAllObserved()

    expect(underlined().sort()).toEqual(['dog', 'fox'])
  })

  it('counts reading', async () => {
    const send = await loadContentScript()
    await send({ action: 'enxRun' })
    await clickWord('#a', 'dog')
    window.dispatchEvent(new Event('pagehide'))

    expect(progressReports()).toHaveLength(1)
  })
})

const page = (attributes: string) => `
  <article>
    <p id="plain">The plain fox runs.</p>
    <p><span id="boxed" ${attributes}>A boxed dog sits.</span></p>
  </article>`

describe('lookup exclusions on a default-adapter page', () => {
  it.each([
    ['role="button"'],
    ['role="link"'],
    ['role="tab"'],
    ['contenteditable'],
    ['contenteditable="true"'],
  ])('a word inside [%s] is neither clickable nor highlighted', async attr => {
    document.body.innerHTML = page(attr)
    const send = await loadContentScript()
    await send({ action: 'enxRun' })
    showAllObserved()

    await clickWord('#boxed', 'dog')

    expect(overlays()).toHaveLength(0)
    expect(underlined()).toEqual(['fox'])
  })

  it('a word inside [contenteditable="false"] is clickable and highlighted', async () => {
    document.body.innerHTML = page('contenteditable="false"')
    const send = await loadContentScript()
    await send({ action: 'enxRun' })
    showAllObserved()

    await clickWord('#boxed', 'dog')

    expect(overlays()).toHaveLength(1)
    expect(underlined().sort()).toEqual(['dog', 'fox'])
  })

  it.each([
    [
      'on a link enclosing the article',
      '<a href="/story"><article>Hello fox world.</article></a>',
    ],
    [
      'on the article root',
      '<article contenteditable="true">Hello fox world.</article>',
    ],
    [
      'on an ancestor outside the article',
      '<div role="button"><article>Hello fox world.</article></div>',
    ],
  ])(
    'an exclusion %s leaves its text unclickable and unhighlighted',
    async (_name, html) => {
      document.body.innerHTML = html
      document
        .querySelector('a')
        ?.addEventListener('click', event => event.preventDefault())
      const send = await loadContentScript()
      await send({ action: 'enxRun' })
      showAllObserved()

      await clickWord('body', 'fox')

      expect(overlays()).toHaveLength(0)
      expect(underlined()).toEqual([])
    }
  )
})

describe('selection lookup exclusions (#664)', () => {
  describe('on a default-adapter page', () => {
    it('selecting a plain word opens its popover', async () => {
      document.body.innerHTML = page('')
      const send = await loadContentScript()
      await send({ action: 'enxRun' })

      await selectText('#plain', 'fox')

      expect(popoverWord()).toContain('fox')
    })

    it.each([['contenteditable'], ['role="button"'], ['role="link"']])(
      'selecting a word inside [%s] opens nothing',
      async attr => {
        document.body.innerHTML = page(attr)
        const send = await loadContentScript()
        await send({ action: 'enxRun' })

        await selectText('#boxed', 'dog')

        expect(overlays()).toHaveLength(0)
      }
    )

    it.each([
      ['a phrase', 'A boxed dog'],
      ['a sentence', 'A boxed dog sits.'],
      ['an over-long selection', prose(400)],
    ])(
      'selecting %s inside [contenteditable] shows no button or hint',
      async (_name, text) => {
        document.body.innerHTML = `<article><p>${prose(200)}</p><p id="boxed" contenteditable>${text}</p></article>`
        const send = await loadContentScript()
        await send({ action: 'enxRun' })

        await selectText('#boxed', text)

        expect(selectionButtons()).toHaveLength(0)
        expect(overlays()).toHaveLength(0)
      }
    )

    it('selecting a word inside a link still opens its popover', async () => {
      document.body.innerHTML = `<article><p>The <a href="/fox">quick fox</a> runs.</p></article>`
      const send = await loadContentScript()
      await send({ action: 'enxRun' })

      await selectText('a', 'fox')

      expect(popoverWord()).toContain('fox')
    })
  })

  describe('on an adapter without lookupExcludedSelectors (RSSX, like X)', () => {
    const loadOnRssx = () => loadContentScript([window.location.origin])

    it('selecting a word inside [contenteditable] opens nothing', async () => {
      document.body.innerHTML = page('contenteditable')
      const send = await loadOnRssx()
      await send({ action: 'enxRun' })

      await selectText('#boxed', 'dog')

      expect(overlays()).toHaveLength(0)
    })

    it('selecting a word inside [role="link"] opens its popover', async () => {
      document.body.innerHTML = page('role="link"')
      const send = await loadOnRssx()
      await send({ action: 'enxRun' })

      await selectText('#boxed', 'dog')

      expect(popoverWord()).toContain('dog')
    })
  })
})
