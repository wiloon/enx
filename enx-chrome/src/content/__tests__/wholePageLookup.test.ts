// #563 (adr-034 amendment): short pages whose article node is short, or that
// have none at all, still enable. These tests load the real content script
// against a jsdom page and a fake background.

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

const loadContentScript = async (): Promise<Send> => {
  await jest.isolateModulesAsync(async () => {
    const { config } = await import('@/config/env')
    Object.assign(config, { rssxOrigins: [] })
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

const popoverWord = () =>
  overlays()[0]?.shadowRoot?.querySelector('[data-testid="word-popover-header"]')
    ?.textContent

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

describe('a Standard Ebooks title page', () => {
  beforeEach(() => {
    document.body.innerHTML = TITLE_PAGE
  })

  it('enables, and both the heading and the byline can be looked up', async () => {
    const send = await loadContentScript()

    expect(await send({ action: 'enxRun' })).toMatchObject({ success: true })

    await clickWord('h1', 'Fiction')
    expect(popoverWord()).toContain('Fiction')
    closeOverlays()
    await clickWord('b', 'Conrad')
    expect(popoverWord()).toContain('Conrad')
  })

  it('sends "By Joseph Conrad." as the sentence of a click on Conrad', async () => {
    const send = await loadContentScript()
    await send({ action: 'enxRun' })
    await clickWord('b', 'Conrad')

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
    const send = await loadContentScript()

    expect(await send({ action: 'enxRun' })).toMatchObject({ success: true })
    await clickWord('#short', 'dog')
    expect(overlays()).toHaveLength(1)
    window.dispatchEvent(new Event('pagehide'))

    expect(progressReports()).toEqual([])
  })

  it('a body found by the largest-text fallback still counts reading', async () => {
    document.body.innerHTML = `<p id="long">The quick brown fox jumps over the lazy dog. ${prose(600)}</p>`
    const send = await loadContentScript()

    expect(await send({ action: 'enxRun' })).toMatchObject({ success: true })
    await clickWord('#long', 'dog')
    window.dispatchEvent(new Event('pagehide'))

    expect(progressReports()).toHaveLength(1)
  })

  it('reports the article read before it once, then nothing from clicks, scrolls or timers', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] })
    const tick = async () => {
      for (let i = 0; i < 10; i++) await jest.advanceTimersByTimeAsync(1)
    }
    document.body.innerHTML =
      `<p id="lead">The quick brown fox jumps over the lazy dog.</p>` +
      `<p id="rest">${prose(600)}</p>`
    const send = await loadContentScript()
    const enabled = send({ action: 'enxRun' })
    await tick()
    expect(await enabled).toMatchObject({ success: true })
    await clickWord('#lead', 'dog', tick)
    const stopped = send({ action: 'enxStop' })
    await tick()
    await stopped
    expect(progressReports()).toEqual([])

    // The same body, now under the largest-text fallback's minimum.
    document.getElementById('rest')!.remove()
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

describe('lookup exclusions on a default-adapter page', () => {
  const page = (attributes: string) => `
    <article>
      <p id="plain">The plain fox runs.</p>
      <p><span id="boxed" ${attributes}>A boxed dog sits.</span></p>
    </article>`

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
    ['on the article root', '<main contenteditable="true">Hello fox world.</main>'],
    [
      'on an ancestor outside the article',
      '<div role="button"><article>Hello fox world.</article></div>',
    ],
  ])('an exclusion %s leaves its text unclickable and unhighlighted', async (_name, html) => {
    document.body.innerHTML = html
    const send = await loadContentScript()
    await send({ action: 'enxRun' })
    showAllObserved()

    await clickWord('body', 'fox')

    expect(overlays()).toHaveLength(0)
    expect(underlined()).toEqual([])
  })
})
