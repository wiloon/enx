// #561: an orphaned content script (its extension reloaded, updated or
// reinstalled) stands down when a fresh script announces itself. These tests
// load the real content script against a jsdom page and a fake background.
// One global `chrome` serves every loaded script, so an orphan is simulated by
// removing the runtime id while the event is dispatched.

import { STAND_DOWN_EVENT } from '@/lib/orphanStandDown'
import type { SiteOrigins } from '@/lib/siteAdapters'

jest.mock('@/config/env')

type Message = { type?: string; action?: string; paragraph?: string }
type Callback = (response: unknown) => void

const ARTICLE_TEXT =
  'The quick brown fox jumps over the lazy dog while the patient reader ' +
  'keeps reading this paragraph about foxes, dogs and other animals.'
const LIVE_ID = 'abcdefghijklmnopqrstuvwxyzabcdef'

const FOX = {
  Key: 'fox',
  English: 'fox',
  Chinese: '狐狸',
  Pronunciation: '',
  LoadCount: 1,
  Known: false,
  WordType: 0,
}

let sent: Message[]
// getWords replies held back by a test, released by releaseWords().
let heldWords: Callback[]
let holdWords: boolean
let showPinHint: boolean
let autoEnable: boolean
let wordsSessionExpired: boolean

const respond = (message: Message): unknown => {
  switch (message.type) {
    case 'learningModeStatus':
      return { success: true, showPinHint }
    case 'getWords':
      return wordsSessionExpired
        ? { success: false, sessionExpired: true }
        : { success: true, wordProperties: { fox: FOX } }
    case 'getOneWord':
      return { success: true, ecp: FOX }
    case 'shouldAutoEnable':
      return { success: true, autoEnable }
    default:
      return { success: true }
  }
}

const releaseWords = async () => {
  const pending = heldWords
  heldWords = []
  pending.forEach(callback => callback(respond({ type: 'getWords' })))
  await settle()
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0))
const settle = async () => {
  for (let i = 0; i < 10; i++) await flush()
}

type Send = (request: unknown) => Promise<Record<string, unknown>>

// Loads content.tsx fresh and returns a sender for its runtime.onMessage.
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

const setRuntimeId = (id: string | undefined) => {
  ;(chrome.runtime as { id?: string }).id = id
}

// What a fresh script's announce looks like to an orphan.
const orphanAndAnnounce = () => {
  setRuntimeId(undefined)
  document.dispatchEvent(new Event(STAND_DOWN_EVENT))
}

const overlays = () => document.querySelectorAll('#enx-anchored-overlay')

const paragraph = () => document.querySelector('article p')!

// jsdom has no layout: resolve every click to "fox" and give every Range a
// box that contains the click.
const clickFox = async () => {
  const text = paragraph().firstChild!
  const offset = text.textContent!.indexOf('fox') + 1
  ;(
    document as unknown as {
      caretPositionFromPoint: (x: number, y: number) => unknown
    }
  ).caretPositionFromPoint = () => ({ offsetNode: text, offset })
  paragraph().dispatchEvent(
    new MouseEvent('click', { bubbles: true, clientX: 5, clientY: 5 })
  )
  await settle()
}

const selectSentence = () => {
  const range = document.createRange()
  range.selectNodeContents(paragraph())
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
  paragraph().dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
}

const selectionButtons = () =>
  document.querySelectorAll('.enx-selection-translate-button')

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
const SPA_ORIGINS = { rssxOrigins: ['http://localhost'] }

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
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'debug').mockImplementation(() => {})
  Range.prototype.getClientRects = () => [BOX] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => BOX as DOMRect
})

beforeEach(() => {
  sent = []
  heldWords = []
  holdWords = false
  showPinHint = false
  autoEnable = false
  wordsSessionExpired = false
  setRuntimeId(LIVE_ID)
  ;(chrome.runtime.sendMessage as jest.Mock).mockImplementation(
    (message: Message, callback?: Callback) => {
      sent.push(message)
      if (!callback) return
      if (message.type === 'getWords' && holdWords) heldWords.push(callback)
      else callback(respond(message))
    }
  )
  ;(chrome.storage.local.get as jest.Mock).mockResolvedValue({})
  document.head.innerHTML = ''
  document.body.innerHTML = `<article><p>${ARTICLE_TEXT}</p></article>`
  delete (window as { navigation?: unknown }).navigation
})

afterEach(async () => {
  // Every script loaded so far stands down, so none leaks into the next test.
  orphanAndAnnounce()
  setRuntimeId(LIVE_ID)
  window.getSelection()?.removeAllRanges()
  jest.restoreAllMocks()
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'debug').mockImplementation(() => {})
})

describe('the stand-down signal', () => {
  it('a script announces itself when it loads', async () => {
    const heard = jest.fn()
    document.addEventListener(STAND_DOWN_EVENT, heard)

    await loadContentScript()

    expect(heard).toHaveBeenCalledTimes(1)
    document.removeEventListener(STAND_DOWN_EVENT, heard)
  })

  it('enabling an already-loaded script announces before processing', async () => {
    const send = await loadContentScript()
    const getWordsSentBefore: number[] = []
    const heard = () =>
      getWordsSentBefore.push(sent.filter(m => m.type === 'getWords').length)
    document.addEventListener(STAND_DOWN_EVENT, heard)

    await send({ action: 'enxRun' })

    expect(getWordsSentBefore).toEqual([0])
    document.removeEventListener(STAND_DOWN_EVENT, heard)
  })
})

describe('a live script', () => {
  it('opens one popover on a word click', async () => {
    const send = await loadContentScript()
    await send({ action: 'enxRun' })

    await clickFox()

    expect(overlays()).toHaveLength(1)
  })

  it('ignores the event, its own or a forged one', async () => {
    const send = await loadContentScript()
    await send({ action: 'enxRun' })

    document.dispatchEvent(new Event(STAND_DOWN_EVENT))
    await loadContentScript() // a second script announcing itself
    await clickFox()

    expect(overlays()).toHaveLength(1)
    expect(CSS.highlights.size).toBeGreaterThan(0)
  })
})

describe('an orphan that is told to stand down', () => {
  it('leaves exactly one popover, the fresh script’s, after re-enable', async () => {
    const orphan = await loadContentScript()
    await orphan({ action: 'enxRun' })
    orphanAndAnnounce()

    setRuntimeId(LIVE_ID)
    const fresh = await loadContentScript()
    await fresh({ action: 'enxRun' })
    await clickFox()

    expect(overlays()).toHaveLength(1)
  })

  it('closes its open popover and opens no more', async () => {
    const send = await loadContentScript()
    await send({ action: 'enxRun' })
    await clickFox()
    expect(overlays()).toHaveLength(1)

    orphanAndAnnounce()
    await clickFox()

    expect(overlays()).toHaveLength(0)
  })

  it('shows no translate button for a drag-selection', async () => {
    const send = await loadContentScript()
    await send({ action: 'enxRun' })
    selectSentence()
    expect(selectionButtons()).toHaveLength(1)

    orphanAndAnnounce()
    expect(selectionButtons()).toHaveLength(0)
    selectSentence()

    expect(selectionButtons()).toHaveLength(0)
  })

  it('stays silent after the fresh script turns learning mode off', async () => {
    const orphan = await loadContentScript()
    await orphan({ action: 'enxRun' })
    orphanAndAnnounce()

    setRuntimeId(LIVE_ID)
    const fresh = await loadContentScript()
    await fresh({ action: 'enxRun' })
    await fresh({ action: 'enxStop' })
    await clickFox()

    expect(overlays()).toHaveLength(0)
  })

  it('stands down even when learning mode was already off', async () => {
    showPinHint = true
    const send = await loadContentScript()
    await send({ action: 'enxRun' })
    await clickFox() // the reading tracker now holds unreported progress
    await send({ action: 'enxStop' })
    await settle()
    expect(document.querySelector('.enx-pin-hint')).not.toBeNull()

    orphanAndAnnounce()
    setRuntimeId(LIVE_ID)
    sent = []
    window.dispatchEvent(new Event('pagehide'))

    expect(document.querySelector('.enx-pin-hint')).toBeNull()
    expect(sent.filter(m => m.type === 'reportReadingProgress')).toEqual([])
  })

  it('never paints or clears highlights when static processing resolves late', async () => {
    holdWords = true
    const send = await loadContentScript()
    const run = send({ action: 'enxRun' })
    await settle()
    expect(heldWords).toHaveLength(1)

    orphanAndAnnounce()
    const set = jest.spyOn(CSS.highlights, 'set')
    const del = jest.spyOn(CSS.highlights, 'delete')
    setRuntimeId(LIVE_ID)
    await releaseWords()
    await run
    await clickFox()

    expect(set).not.toHaveBeenCalled()
    expect(del).not.toHaveBeenCalled()
    expect(overlays()).toHaveLength(0)
  })

  it('never rebinds clicks or paints after an SPA navigation', async () => {
    const navigation = new FakeNavigation()
    ;(window as { navigation?: unknown }).navigation = navigation
    holdWords = true
    const send = await loadContentScript(SPA_ORIGINS)
    const run = send({ action: 'enxRun' })
    await new Promise(resolve => setTimeout(resolve, 150)) // ready debounce
    await settle()
    expect(heldWords).toHaveLength(1)

    orphanAndAnnounce()
    const set = jest.spyOn(CSS.highlights, 'set')
    const del = jest.spyOn(CSS.highlights, 'delete')
    setRuntimeId(LIVE_ID)
    await releaseWords()
    await run
    navigation.navigate('http://localhost/?article=2')
    await new Promise(resolve => setTimeout(resolve, 150))
    await settle()
    await clickFox()

    expect(set).not.toHaveBeenCalled()
    expect(del).not.toHaveBeenCalled()
    expect(sent.filter(m => m.type === 'getWords')).toHaveLength(1)
    expect(overlays()).toHaveLength(0)
  })
})

describe('an orphan nobody told to stand down', () => {
  it('still shows the error and the Reload page button', async () => {
    const send = await loadContentScript()
    await send({ action: 'enxRun' })
    setRuntimeId(undefined)

    await clickFox()

    expect(overlays()).toHaveLength(1)
    const text = overlays()[0].shadowRoot!.textContent
    expect(text).toContain('Reload this page')
    expect(text).toContain('Reload page')
  })
})

describe('stopping learning mode on an SPA site', () => {
  const startPendingSpaRun = async () => {
    ;(window as { navigation?: unknown }).navigation = new FakeNavigation()
    holdWords = true
    const send = await loadContentScript(SPA_ORIGINS)
    const run = send({ action: 'enxRun' })
    await new Promise(resolve => setTimeout(resolve, 150)) // ready debounce
    await settle()
    expect(heldWords).toHaveLength(1)
    return { send, run }
  }

  it.each([['enxStop'], ['sessionExpired']])(
    '%s: the superseded run answers OK and paints nothing',
    async action => {
      const { send, run } = await startPendingSpaRun()

      await send({ action })
      const set = jest.spyOn(CSS.highlights, 'set')
      await releaseWords()
      await clickFox()

      expect(await run).toMatchObject({ success: true })
      expect(set).not.toHaveBeenCalled()
      expect(overlays()).toHaveLength(0)
    }
  )

  // The rollback runs once the first run has settled, so there is nothing in
  // flight to cancel; its stop must still leave nothing armed.
  it('auto-enable rollback: a later navigation processes nothing', async () => {
    const navigation = new FakeNavigation()
    ;(window as { navigation?: unknown }).navigation = navigation
    autoEnable = true
    wordsSessionExpired = true
    await loadContentScript(SPA_ORIGINS)
    await new Promise(resolve => setTimeout(resolve, 150)) // ready debounce
    await settle()
    expect(sent.filter(m => m.type === 'getWords')).toHaveLength(1)

    wordsSessionExpired = false
    const set = jest.spyOn(CSS.highlights, 'set')
    navigation.navigate('http://localhost/?article=2')
    await new Promise(resolve => setTimeout(resolve, 150))
    await settle()
    await clickFox()

    expect(sent.filter(m => m.type === 'getWords')).toHaveLength(1)
    expect(set).not.toHaveBeenCalled()
    expect(overlays()).toHaveLength(0)
  })

  it('enxRun again: only the newer run paints', async () => {
    const { send, run } = await startPendingSpaRun()

    const rerun = send({ action: 'enxRun' })
    await new Promise(resolve => setTimeout(resolve, 150))
    await settle()
    expect(heldWords).toHaveLength(2)
    const set = jest.spyOn(CSS.highlights, 'set')
    const [first, second] = heldWords
    heldWords = [first]
    await releaseWords()

    expect(await run).toMatchObject({ success: true })
    expect(set).not.toHaveBeenCalled()

    heldWords = [second]
    await releaseWords()
    expect(await rerun).toMatchObject({ success: true })
    expect(set).toHaveBeenCalled()
  })
})
