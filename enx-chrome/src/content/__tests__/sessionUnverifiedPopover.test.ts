// #686: a word lookup (or AI lookup) whose forced replay carried a freshly
// minted token and still got a 401. The real content script runs against a
// jsdom page, and its lookups go through the real background handlers.

import { STAND_DOWN_EVENT } from '@/lib/orphanStandDown'
import { showAllObserved } from '@/test/fakeIntersectionObserver'

jest.mock('@/config/env')
jest.mock('@clerk/chrome-extension/client', () => ({
  createClerkClient: jest.fn(),
}))

import { createClerkClient } from '@clerk/chrome-extension/client'
import { __resetClerkClientCacheForTests } from '@/background/background'

type Message = { type?: string; action?: string }
type Callback = (response: unknown) => void
type Listener = (
  request: unknown,
  sender: unknown,
  sendResponse: Callback
) => unknown

// Registered when ../../background was imported above.
const background = (chrome.runtime.onMessage.addListener as jest.Mock).mock
  .calls[0][0] as Listener

const LIVE_ID = 'abcdefghijklmnopqrstuvwxyzabcdef'
const ARTICLE_TEXT =
  'The quick fox jumps over the lazy dog while the patient reader keeps ' +
  'reading this paragraph about animals.'
const UNVERIFIED =
  "We couldn't verify your sign-in. Try again, or sign in again."
const FOX = {
  Id: 'w-fox',
  Key: 'fox',
  English: 'fox',
  Chinese: '狐狸',
  Pronunciation: '',
  LoadCount: 1,
  Known: false,
  WordType: 0,
}
const FOX_MISS = {
  ...FOX,
  Id: undefined,
  Chinese: '',
  AIFallback: { CanUse: true, Auto: true },
}

let sent: Message[]
let api: (url: string) => { status: number; body: unknown }
let sessionStorage: Record<string, unknown>

const jsonResponse = (status: number, body: unknown) => ({
  ok: status < 400,
  status,
  statusText: status < 400 ? 'OK' : 'Unauthorized',
  headers: new Headers(),
  json: async () => body,
  text: async () => JSON.stringify(body),
})

// Lookups go to the real background; the page's other requests get canned
// answers.
const BACKGROUND_TYPES = new Set(['getOneWord', 'defineWordWithAI'])
const canned = (message: Message): unknown => {
  switch (message.type) {
    case 'getReviewWords':
      return { success: true, reviewWords: [['fox', 1]] }
    case 'shouldAutoEnable':
      return { success: true, autoEnable: false }
    default:
      return { success: true }
  }
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0))
const settle = async () => {
  for (let i = 0; i < 20; i++) await flush()
}

const loadContentScript = async () => {
  await jest.isolateModulesAsync(async () => {
    const { config } = await import('@/config/env')
    Object.assign(config, { rssxOrigins: [] })
    await import('../content')
  })
  const calls = (chrome.runtime.onMessage.addListener as jest.Mock).mock.calls
  const listener = calls[calls.length - 1][0] as Listener
  return (request: unknown) =>
    new Promise<Record<string, unknown>>(resolve => {
      listener(request, {}, resolve as Callback)
    })
}

const paragraph = () => document.querySelector('article p')!
const overlays = () => document.querySelectorAll('#enx-anchored-overlay')
const inPopover = (testId: string) =>
  overlays()[0]?.shadowRoot?.querySelector(`[data-testid="${testId}"]`) ?? null
const lookups = () => sent.filter(m => m.type === 'getOneWord')
const statusReports = () =>
  sent
    .filter(m => m.type === 'learningModeStatus')
    .map(m => (m as { status?: unknown }).status)
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
  __resetClerkClientCacheForTests()
  sent = []
  sessionStorage = {}
  // A signed-in Clerk session whose fresh tokens enx-api still refuses.
  const getToken = jest.fn(async (options?: { skipCache?: boolean }) =>
    options?.skipCache ? 'fresh-token-f7e3c1d9' : 'cached-token'
  )
  ;(createClerkClient as jest.Mock).mockImplementation(async () => ({
    session: { getToken },
    user: { id: 'user-a' },
  }))
  api = url =>
    url.includes('/api/translate?word=')
      ? { status: 401, body: {} }
      : { status: 200, body: {} }
  global.fetch = jest.fn(async (url: string) => {
    const { status, body } = api(url)
    return jsonResponse(status, body)
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
  ;(chrome.storage.local.get as jest.Mock).mockResolvedValue({})
  ;(chrome.storage.local.set as jest.Mock).mockResolvedValue(undefined)
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
  document.head.innerHTML = ''
  document.body.innerHTML = `<article><p>${ARTICLE_TEXT}</p></article>`
})

afterEach(() => {
  ;(chrome.runtime as { id?: string }).id = undefined
  document.dispatchEvent(new Event(STAND_DOWN_EVENT))
  ;(chrome.runtime as { id?: string }).id = LIVE_ID
  CSS.highlights.clear()
  jest.restoreAllMocks()
})

const startReading = async () => {
  const send = await loadContentScript()
  await send({ action: 'enxRun' })
  showAllObserved()
  await settle()
  expect(underlined()).toContain('fox')
  return send
}

const expectUnverifiedPopover = async (
  send: (request: unknown) => Promise<Record<string, unknown>>,
  bodyChildren: number
) => {
  expect(overlays()).toHaveLength(1)
  const notice = inPopover('word-popover-unverified')
  expect(notice).toHaveTextContent(UNVERIFIED)
  expect(
    [...notice!.querySelectorAll('button')].map(b => b.textContent)
  ).toEqual(['Retry', 'Sign in'])
  expect(inPopover('word-popover-signed-out')).toBeNull()
  // Learning mode, highlights and the badge stay as they were.
  expect(underlined()).toContain('fox')
  expect(await send({ action: 'getPageInfo' })).toMatchObject({
    isEnxEnabled: true,
  })
  expect(statusReports()).not.toContainEqual(
    expect.objectContaining({ status: 'error' })
  )
  expect(statusReports().at(-1)).toEqual({ status: 'ready' })
  // No session message reached any page or tab.
  expect(chrome.tabs.sendMessage).not.toHaveBeenCalled()
  expect(sent.filter(m => m.action)).toEqual([])
  // Only the popover itself was added to the host page.
  expect(document.body.children.length).toBe(bodyChildren + 1)
}

describe('a lookup whose session is unverified', () => {
  it('keeps the popover open with the unverified notice, Retry and Sign in', async () => {
    const send = await startReading()
    const bodyChildren = document.body.children.length

    await clickFox()

    await expectUnverifiedPopover(send, bodyChildren)
  })

  it('re-sends the same lookup from Retry as a fresh attempt', async () => {
    await startReading()
    await clickFox()
    api = url =>
      url.includes('/api/translate?word=')
        ? { status: 200, body: FOX }
        : { status: 200, body: {} }

    ;(inPopover('word-popover-unverified-retry') as HTMLButtonElement).click()
    await settle()

    expect(lookups()).toEqual([
      { type: 'getOneWord', word: 'fox' },
      { type: 'getOneWord', word: 'fox' },
    ])
    expect(inPopover('word-popover-unverified')).toBeNull()
    expect(inPopover('word-popover-content')).toHaveTextContent('狐狸')
  })

  it('starts the web sign-in from Sign in', async () => {
    await startReading()
    await clickFox()

    ;(inPopover('word-popover-unverified-sign-in') as HTMLButtonElement).click()

    expect(sent).toContainEqual({ action: 'openWebSignIn' })
  })
})

// #688: every mint fails, and the recheck still finds the session but its
// fresh mint fails too. The lookup never reaches enx-api.
describe('a lookup whose session token cannot be minted', () => {
  it('shows the ordinary error and leaves learning mode and highlights on', async () => {
    const send = await startReading()
    const bodyChildren = document.body.children.length
    ;(createClerkClient as jest.Mock).mockImplementation(async () => ({
      session: { getToken: async () => null },
      user: { id: 'user-a' },
    }))
    __resetClerkClientCacheForTests()
    const fetches = (global.fetch as jest.Mock).mock.calls.length

    await clickFox()

    expect(overlays()).toHaveLength(1)
    expect(inPopover('word-popover-error')).toHaveTextContent(
      "Couldn't reach the sign-in service. Please try again."
    )
    expect(inPopover('word-popover-signed-out')).toBeNull()
    expect(inPopover('word-popover-unverified')).toBeNull()
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(fetches)
    expect(underlined()).toContain('fox')
    expect(await send({ action: 'getPageInfo' })).toMatchObject({
      isEnxEnabled: true,
    })
    expect(statusReports()).not.toContainEqual(
      expect.objectContaining({ status: 'error' })
    )
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled()
    expect(sent.filter(m => m.action)).toEqual([])
    expect(document.body.children.length).toBe(bodyChildren + 1)
  })
})

describe('an AI lookup whose session is unverified', () => {
  beforeEach(() => {
    api = url =>
      url.includes('/api/translate?word=')
        ? { status: 200, body: FOX_MISS }
        : url.includes('/api/dictionary/ai-word')
          ? { status: 401, body: {} }
          : { status: 200, body: {} }
  })

  it('keeps the popover open with the unverified notice, Retry and Sign in', async () => {
    const send = await startReading()
    const bodyChildren = document.body.children.length

    await clickFox()

    expect(sent.filter(m => m.type === 'defineWordWithAI')).toHaveLength(1)
    await expectUnverifiedPopover(send, bodyChildren)
  })

  it('re-sends the AI lookup from Retry', async () => {
    await startReading()
    await clickFox()
    api = url =>
      url.includes('/api/dictionary/ai-word')
        ? {
            status: 200,
            body: { found: true, word: { ...FOX, Chinese: 'n. 狐狸（AI）' } },
          }
        : { status: 200, body: {} }

    ;(inPopover('word-popover-unverified-retry') as HTMLButtonElement).click()
    await settle()

    expect(sent.filter(m => m.type === 'defineWordWithAI')).toEqual([
      { type: 'defineWordWithAI', word: 'fox' },
      { type: 'defineWordWithAI', word: 'fox' },
    ])
    expect(lookups()).toHaveLength(1)
    expect(inPopover('word-popover-unverified')).toBeNull()
    expect(inPopover('word-popover-content')).toHaveTextContent('n. 狐狸（AI）')
  })
})
