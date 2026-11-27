// ADR-095 / #1187: learning mode and click-to-lookup in a browser that never
// signed in. The real content script runs against a jsdom page, and its
// messages go through the real background handlers.

import { STAND_DOWN_EVENT } from '@/lib/orphanStandDown'
import { showAllObserved } from '@/test/fakeIntersectionObserver'

jest.mock('@/config/env')
jest.mock('@/lib/auth/selectWorkerAuth', () =>
  jest.requireActual('@/test/fakeWorkerAuth')
)

import { createClient, fakeSession } from '@/test/fakeWorkerAuth'
import { __resetClerkClientCacheForTests } from '@/background/background'
import type { AuthClient } from '@/lib/auth/types'

type Message = { type?: string; action?: string }
type Callback = (response: unknown) => void
type Listener = (
  request: unknown,
  sender: unknown,
  sendResponse: Callback
) => unknown

const background = (chrome.runtime.onMessage.addListener as jest.Mock).mock
  .calls[0][0] as Listener

const LIVE_ID = 'abcdefghijklmnopqrstuvwxyzabcdef'
const ARTICLE_TEXT =
  'The quick fox jumps over the lazy dog while the patient reader keeps ' +
  'reading this paragraph about animals.'
const SAVE_PROMPT = 'Sign in to save this word and see it underlined next time.'
const NOT_FOUND = 'No definition found. Sign in to get an AI explanation.'
const LIMIT =
  "You've reached today's limit for lookups without an account. Sign in to keep going."
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const ANONYMOUS_PATH = '/api/anonymous/dictionary/entry'
const FOX_FOUND = {
  Word: 'fox',
  Status: 'found',
  Id: 'w-fox',
  English: 'fox',
  Pronunciation: 'fɒks',
  Chinese: 'n. 狐狸',
}

const signedOut: AuthClient = {
  hasSession: () => false,
  classifySession: async () => 'absent',
  subject: () => null,
  getToken: async () => null,
}

let sent: Message[]
let anonymous: () => { status: number; body: unknown }
let localStorage: Record<string, unknown>
let sessionStorage: Record<string, unknown>
let tracker: typeof import('@/content/readingTracker')

const jsonResponse = (status: number, body: unknown) => ({
  ok: status < 400,
  status,
  statusText: 'OK',
  headers: new Headers(),
  json: async () => body,
  text: async () => JSON.stringify(body),
})

const BACKGROUND_TYPES = new Set([
  'learningAccess',
  'getAnonymousEntry',
  'getOneWord',
  'getReviewWords',
  'recordWordLookup',
  'prefetchDefinitions',
  'markKnown',
])
const canned = (message: Message): unknown =>
  message.type === 'shouldAutoEnable'
    ? { success: true, autoEnable: false }
    : { success: true }

const flush = () => new Promise(resolve => setTimeout(resolve, 0))
const settle = async () => {
  for (let i = 0; i < 20; i++) await flush()
}

const loadContentScript = async () => {
  await jest.isolateModulesAsync(async () => {
    const { config } = await import('@/config/env')
    Object.assign(config, { rssxOrigins: [] })
    await import('../content')
    tracker = await import('@/content/readingTracker')
  })
  const calls = (chrome.runtime.onMessage.addListener as jest.Mock).mock.calls
  const listener = calls[calls.length - 1][0] as Listener
  return (request: unknown) =>
    new Promise<Record<string, unknown>>(resolve => {
      listener(request, {}, resolve as Callback)
    })
}

const fetches = () =>
  (global.fetch as jest.Mock).mock.calls as [string, RequestInit][]
const anonymousFetches = () =>
  fetches().filter(([url]) => url.endsWith(ANONYMOUS_PATH))
const headersOf = (init: RequestInit) =>
  (init.headers ?? {}) as Record<string, string>
const paragraph = () =>
  document.querySelector('article p, #enx-reader-article p')!
const overlays = () => document.querySelectorAll('#enx-anchored-overlay')
const inPopover = (testId: string) =>
  overlays()[0]?.shadowRoot?.querySelector(`[data-testid="${testId}"]`) ?? null
const underlined = () =>
  [...CSS.highlights]
    .filter(([name]) => name.startsWith('enx-hl-'))
    .flatMap(([, h]) =>
      [...(h as unknown as Iterable<Range>)].map(r => r.toString())
    )

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
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
  sent = []
  localStorage = {}
  sessionStorage = {}
  createClient.mockImplementation(async () => signedOut)
  anonymous = () => ({ status: 200, body: FOX_FOUND })
  global.fetch = jest.fn(async (url: string) => {
    if (url.endsWith(ANONYMOUS_PATH)) {
      const { status, body } = anonymous()
      return jsonResponse(status, body)
    }
    return jsonResponse(200, { success: true, data: [] })
  }) as unknown as typeof fetch
  ;(chrome.runtime as { id?: string }).id = LIVE_ID
  ;(chrome.runtime.sendMessage as jest.Mock).mockImplementation(
    (message: Message, callback?: Callback) => {
      sent.push(message)
      if (!callback) return Promise.resolve()
      if (message.type && BACKGROUND_TYPES.has(message.type)) {
        background(message, {}, callback)
      } else callback(canned(message))
    }
  )
  ;(chrome.storage.local.get as jest.Mock).mockImplementation(
    async (key: string) => ({ [key]: localStorage[key] })
  )
  ;(chrome.storage.local.set as jest.Mock).mockImplementation(
    async (items: Record<string, unknown>) => {
      Object.assign(localStorage, items)
    }
  )
  ;(chrome.storage.session.get as jest.Mock).mockImplementation(
    async (key: string) => ({ [key]: sessionStorage[key] })
  )
  ;(chrome.storage.session.set as jest.Mock).mockImplementation(
    async (items: Record<string, unknown>) => {
      Object.assign(sessionStorage, items)
    }
  )
  ;(chrome.tabs.query as jest.Mock).mockResolvedValue([{ id: 1 }])
  ;(chrome.tabs.sendMessage as jest.Mock).mockResolvedValue(undefined)
  __resetClerkClientCacheForTests()
  window.history.replaceState({}, '', '/')
  document.head.innerHTML = ''
  document.body.innerHTML = `<article><p>${ARTICLE_TEXT}</p></article>`
  delete document.documentElement.dataset.enxLookedUp
})

afterEach(async () => {
  ;(chrome.runtime as { id?: string }).id = undefined
  document.dispatchEvent(new Event(STAND_DOWN_EVENT))
  ;(chrome.runtime as { id?: string }).id = LIVE_ID
  CSS.highlights.clear()
  const { config } = await import('@/config/env')
  Object.assign(config, {
    rssxOrigins: [],
    uiOrigins: ['http://localhost:3000'],
  })
  jest.restoreAllMocks()
})

const selectText = async (from: string, to: string) => {
  const text = paragraph().firstChild as Text
  const range = document.createRange()
  range.setStart(text, text.data.indexOf(from))
  range.setEnd(text, text.data.indexOf(to) + to.length)
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
  paragraph().dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  await settle()
}

const clickSelectionButton = async () => {
  const button = document.querySelector('.enx-selection-translate-button')
  expect(button).not.toBeNull()
  button!.shadowRoot!.querySelector('button')!.click()
  await settle()
}

const startReading = async () => {
  const send = await loadContentScript()
  const reply = await send({ action: 'enxRun' })
  showAllObserved()
  await settle()
  return { send, reply }
}

const expectNoAccountTraffic = () => {
  for (const [, init] of fetches()) {
    expect(headersOf(init)).not.toHaveProperty('Authorization')
  }
  expect(fetches().map(([url]) => url)).toEqual(
    anonymousFetches().map(([url]) => url)
  )
  // No session broadcast reached any tab, and the badge shows no `!`.
  expect(chrome.tabs.sendMessage).not.toHaveBeenCalled()
  expect(sent).not.toContainEqual(
    expect.objectContaining({
      type: 'learningModeStatus',
      status: expect.objectContaining({ status: 'error' }),
    })
  )
}

describe('anonymous mode: signed out in a browser that never signed in', () => {
  it('turns learning mode on without the review list or the reading tracker', async () => {
    const { send, reply } = await startReading()

    expect(reply).toEqual({ success: true, completed: true })
    expect(await send({ action: 'getPageInfo' })).toMatchObject({
      isEnxEnabled: true,
    })
    expect(tracker.__currentSessionForTests()).toBeNull()
    expectNoAccountTraffic()
  })

  it('shows the definition with the sign-in line and no count or Know It', async () => {
    await startReading()

    await clickFox()

    expect(overlays()).toHaveLength(1)
    expect(inPopover('word-popover-content')).toHaveTextContent('n. 狐狸')
    expect(inPopover('word-popover-anonymous')).toHaveTextContent(SAVE_PROMPT)
    expect(inPopover('word-popover-mark-known')).toBeNull()
    expect(inPopover('word-popover-header')).not.toHaveTextContent(/\d/)

    // Enter does not mark the word known.
    const card = inPopover('word-popover-header')!.parentElement!
    card.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    )
    await settle()
    expect(sent.filter(m => m.type === 'markKnown')).toEqual([])

    ;(inPopover('word-popover-anonymous-sign-in') as HTMLButtonElement).click()
    expect(sent).toContainEqual({ action: 'openWebSignIn' })

    // Nothing is recorded, underlined or kept for the word.
    expect(sent.filter(m => m.type === 'recordWordLookup')).toEqual([])
    expect(sent.filter(m => m.type === 'recordPageWordLookup')).toEqual([])
    expect(underlined()).toEqual([])
    expectNoAccountTraffic()
  })

  it('sends the same device id on every lookup, and a new request for a repeat word', async () => {
    await startReading()

    await clickFox()
    await clickFox()

    const sentIds = anonymousFetches().map(
      ([, init]) => headersOf(init)['X-Enx-Device-Id']
    )
    expect(sentIds).toHaveLength(2)
    expect(sentIds[0]).toMatch(UUID)
    expect(sentIds[1]).toBe(sentIds[0])
    expect(anonymousFetches()[0][1].body).toBe(JSON.stringify({ word: 'fox' }))
  })

  it('shows not-found with Sign in and no AI lookup', async () => {
    anonymous = () => ({
      status: 200,
      body: { Word: 'fox', Status: 'not_found' },
    })
    await startReading()

    await clickFox()

    expect(inPopover('word-popover-anonymous')).toHaveTextContent(NOT_FOUND)
    expect(inPopover('word-popover-ai-lookup')).toBeNull()
    expect(sent.filter(m => m.type === 'defineWordWithAI')).toEqual([])
  })

  it("shows the daily limit's message with Sign in", async () => {
    anonymous = () => ({
      status: 429,
      body: { code: 'anonymous_lookup_limit_exceeded', message: LIMIT },
    })
    await startReading()

    await clickFox()

    expect(inPopover('word-popover-anonymous')).toHaveTextContent(LIMIT)
    expectNoAccountTraffic()
  })

  it('shows the normal signed-out prompt when anonymous lookups are off', async () => {
    anonymous = () => ({
      status: 403,
      body: { code: 'anonymous_lookup_disabled' },
    })
    const { send } = await startReading()

    await clickFox()

    expect(inPopover('word-popover-signed-out')).not.toBeNull()
    expect(inPopover('word-popover-anonymous')).toBeNull()
    expect(await send({ action: 'getPageInfo' })).toMatchObject({
      isEnxEnabled: true,
    })
    expectNoAccountTraffic()
  })
})

describe('signed out in a browser that has signed in before', () => {
  it('fails as today, with no anonymous request', async () => {
    localStorage['enx-ever-signed-in'] = true
    const { reply } = await startReading()

    expect(reply).toMatchObject({ success: false, reason: 'session-expired' })
    await clickFox()
    expect(anonymousFetches()).toEqual([])
  })
})

describe('a sign-in sets the flag', () => {
  it('keeps a signed-out browser out of anonymous mode once it has signed in', async () => {
    createClient.mockImplementation(async () =>
      fakeSession('user-a', async () => 'token')
    )
    await startReading()
    expect(localStorage['enx-ever-signed-in']).toBe(true)
  })
})

describe('account-owned triggers in anonymous mode', () => {
  // The reader never signed in, so the prompt says what signing in adds,
  // not that a session ended.
  const expectSentencePrompt = () => {
    expect(inPopover('word-popover-anonymous')?.textContent).toContain(
      'Sign in to translate sentences and phrases.'
    )
    expect(inPopover('word-popover-signed-out')).toBeNull()
  }

  it('shows Sign in for Translate sentence and sends no openSentencePanel', async () => {
    const { send } = await startReading()
    await clickFox()

    ;(
      inPopover('word-popover-sentence-translation') as HTMLButtonElement
    ).click()
    await settle()

    expect(sent.filter(m => m.type === 'openSentencePanel')).toEqual([])
    expectSentencePrompt()
    expect(await send({ action: 'getPageInfo' })).toMatchObject({
      isEnxEnabled: true,
    })
  })

  it('shows Sign in in the anchored overlay for a selection, with no panel request', async () => {
    const { send } = await startReading()
    await selectText('quick', 'jumps')
    await clickSelectionButton()

    expect(sent.filter(m => m.type === 'openSentencePanel')).toEqual([])
    expectSentencePrompt()
    expect(await send({ action: 'getPageInfo' })).toMatchObject({
      isEnxEnabled: true,
    })
  })

  it('shows Sign in for a selected sentence, with no panel request', async () => {
    await startReading()

    await selectText('The', 'animals.')
    await clickSelectionButton()

    expect(sent.filter(m => m.type === 'openSentencePanel')).toEqual([])
    expectSentencePrompt()
  })

  it('shows Sign in for the hover button, with no panel request', async () => {
    await startReading()
    const text = paragraph().firstChild!
    ;(
      document as unknown as {
        caretPositionFromPoint: (x: number, y: number) => unknown
      }
    ).caretPositionFromPoint = () => ({
      offsetNode: text,
      offset: text.textContent!.indexOf('fox') + 1,
    })
    paragraph().dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, clientX: 5, clientY: 5 })
    )
    // The dwell before the button appears (ADR-068).
    await new Promise(resolve => setTimeout(resolve, 500))
    const button = document.querySelector(
      '.enx-hover-sentence-translate-button'
    )
    expect(button).not.toBeNull()

    button!.shadowRoot!.querySelector('button')!.click()
    await settle()

    expect(sent.filter(m => m.type === 'openSentencePanel')).toEqual([])
    expectSentencePrompt()
  })
})

describe('sign-in while reading anonymously', () => {
  it('re-runs under the account when no accountChanged reaches the tab', async () => {
    // The first sync cannot be confirmed: no owner is ever recorded, so the
    // later sign-in is not an account change.
    createClient.mockImplementation(async () => ({
      ...signedOut,
      classifySession: async () => 'unconfirmed' as const,
    }))
    const { send } = await startReading()
    ;(chrome.tabs.sendMessage as jest.Mock).mockImplementation(
      async (_tabId: number, message: unknown) => send(message)
    )
    expect(tracker.__currentSessionForTests()).toBeNull()

    createClient.mockImplementation(async () =>
      fakeSession('user-a', async () => 'token')
    )
    __resetClerkClientCacheForTests()
    await clickFox()
    showAllObserved()
    await settle()

    expect(chrome.tabs.sendMessage).not.toHaveBeenCalledWith(1, {
      action: 'accountChanged',
    })
    expect(overlays()).toHaveLength(0)
    expect(await send({ action: 'getPageInfo' })).toMatchObject({
      isEnxEnabled: true,
    })
    expect(sent.some(m => m.type === 'getReviewWords')).toBe(true)
    expect(tracker.__currentSessionForTests()).not.toBeNull()
  })

  it('closes the popover and re-runs learning mode under the account', async () => {
    const { send } = await startReading()
    await clickFox()
    expect(overlays()).toHaveLength(1)
    expect(tracker.__currentSessionForTests()).toBeNull()

    localStorage['enx-ever-signed-in'] = true
    createClient.mockImplementation(async () =>
      fakeSession('user-a', async () => 'token')
    )
    __resetClerkClientCacheForTests()
    global.fetch = jest.fn(async (url: string) => {
      if (String(url).includes('/api/')) {
        return jsonResponse(200, { success: true, data: [], reviewWords: [] })
      }
      return jsonResponse(200, { success: true, data: [] })
    }) as unknown as typeof fetch

    await send({ action: 'accountChanged' })
    showAllObserved()
    await settle()

    expect(overlays()).toHaveLength(0)
    expect(await send({ action: 'getPageInfo' })).toMatchObject({
      isEnxEnabled: true,
    })
    expect(tracker.__currentSessionForTests()).not.toBeNull()
    expect(sent.some(m => m.type === 'getReviewWords')).toBe(true)
  })
})

describe('data-enx-looked-up on enx-ui', () => {
  it('stamps the mark after a lookup on an enx-ui origin', async () => {
    window.history.replaceState({}, '', '/welcome')
    document.body.innerHTML = `<div id="enx-reader-article"><p>${ARTICLE_TEXT}</p></div>`
    await jest.isolateModulesAsync(async () => {
      const { config } = await import('@/config/env')
      Object.assign(config, {
        rssxOrigins: [],
        uiOrigins: [window.location.origin],
      })
      await import('../content')
      tracker = await import('@/content/readingTracker')
    })
    const calls = (chrome.runtime.onMessage.addListener as jest.Mock).mock.calls
    const listener = calls[calls.length - 1][0] as Listener
    const send = (request: unknown) =>
      new Promise<Record<string, unknown>>(resolve => {
        listener(request, {}, resolve as Callback)
      })
    const reply = await send({ action: 'enxRun' })
    expect(reply).toEqual({ success: true, completed: true })
    showAllObserved()
    await settle()

    expect(document.documentElement.hasAttribute('data-enx-looked-up')).toBe(
      false
    )
    await clickFox()
    expect(document.documentElement.getAttribute('data-enx-looked-up')).toBe(
      '1'
    )
  })

  it('does not stamp the mark on a non-enx-ui origin', async () => {
    // Restore the mock env's uiOrigins in case a prior test widened them.
    const { config } = await import('@/config/env')
    Object.assign(config, { uiOrigins: ['http://localhost:3000'] })
    await startReading()
    await clickFox()
    expect(document.documentElement.hasAttribute('data-enx-looked-up')).toBe(
      false
    )
  })
})
