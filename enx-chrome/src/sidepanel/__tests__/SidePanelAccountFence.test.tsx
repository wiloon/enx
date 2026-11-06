// #236: real background responses driven through the side panel. A request
// whose session was lost renders the signed-out row with Sign in; a request
// that a signed-in account superseded, before or after it was classified,
// renders an ordinary failure (Retry where the row has one).
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'

jest.mock('@/config/env', () => ({
  config: {
    apiBaseUrl: 'http://localhost:8090',
    frontendBaseUrl: 'http://localhost:3000',
    clerkPublishableKey: 'pk_test_x',
    clerkSyncHost: 'https://clerk.localhost.test',
    uiOrigins: ['http://localhost:3000'],
    environment: 'test',
  },
}))
jest.mock('@/lib/sentry', () => ({ initSentry: jest.fn() }))
jest.mock('@clerk/chrome-extension/client', () => ({
  createClerkClient: jest.fn(),
}))
jest.mock('@/services/api', () => ({ sendMessageToBackground: jest.fn() }))

import { createClerkClient } from '@clerk/chrome-extension/client'
import { sendMessageToBackground } from '@/services/api'
import { __resetClerkClientCacheForTests } from '@/background/background'
import { pendingSentenceKey } from '@/lib/sidePanel'
import SidePanel from '../SidePanel'

type Listener = (
  message: { type?: string; action?: string },
  sender: unknown,
  sendResponse: (response: unknown) => void
) => unknown

// Registered when ../background was imported, before any test clears mocks.
const background = (chrome.runtime.onMessage.addListener as jest.Mock).mock
  .calls[0][0] as Listener
const onCookieChanged = (chrome.cookies.onChanged.addListener as jest.Mock).mock
  .calls[0][0] as (change: unknown) => Promise<void>

const PANEL_TAB_ID = 7
const OWNER_KEY = 'enx-account-session-owner'
const SENTENCE = 'Cats are great pets.'
const OTHER_SENTENCE = 'Dogs are loyal friends.'
const SIGNED_OUT = "You've been signed out. Sign in to keep looking up words."
const SIGN_IN_CHANGED =
  'Your sign-in changed while this was loading. Please try again.'

const getToken = jest.fn(async () => 'clerk-session-jwt')
let clerkUserId = 'user-a'
let clerkSession: { getToken: typeof getToken } | null = { getToken }

const deferred = <T,>() => {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>(r => {
    resolve = r
  })
  return { promise, resolve }
}

const json = (status: number, body: unknown) => ({
  ok: status < 400,
  status,
  statusText: status < 400 ? 'OK' : 'Unauthorized',
  headers: new Headers(),
  json: async () => body,
  text: async () => JSON.stringify(body),
})

// Requests the test answers itself, matched by URL and body; the rest get a
// 200 with the usual data.
type Route = { matches: (request: string) => boolean; started: boolean }
let routes: Array<Route & { respond: () => Promise<unknown> }>
const route = (
  matches: (request: string) => boolean,
  respond: () => Promise<unknown>
): Route => {
  const r = { matches, respond, started: false }
  routes.push(r)
  return r
}
const hold = (matches: (request: string) => boolean) => {
  const response = deferred<unknown>()
  const r = route(matches, () => response.promise)
  return { route: r, finish: response.resolve }
}
// A real expiry: the force-refreshed retry also gets a 401, and Clerk holds
// no session from then on.
const answer401 = (matches: (request: string) => boolean) => {
  let calls = 0
  return route(matches, async () => {
    if (++calls === 2) clerkSession = null
    return json(401, {})
  })
}

const fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
  const request = `${url} ${init?.body ?? ''}`
  const r = routes.find(r => r.matches(request))
  if (r) {
    r.started = true
    return r.respond()
  }
  if (url.includes('/api/translate/sentence')) {
    return json(200, { chinese: '猫是很棒的宠物。' })
  }
  if (url.includes('/api/translate/word-in-context')) {
    return json(200, { chinese: '很棒的' })
  }
  if (url.includes('/api/translate?word=')) {
    return json(200, { English: 'great', Chinese: '大的' })
  }
  return json(200, {})
})

// Responses wait here, after the background has classified them, until the
// test lets the panel receive them.
let deliveryGates: Map<string, Promise<void>>
let answered: Map<string, { sessionExpired?: boolean }>
const gateDelivery = (type: string) => {
  const gate = deferred<void>()
  deliveryGates.set(type, gate.promise)
  return () => act(async () => gate.resolve())
}

let pageListeners: Set<Listener>
let storageListeners: Array<(changes: unknown, area: string) => void>
let ownerWrite: Promise<void> | null

const cookie = {
  cookie: { domain: 'clerk.localhost.test', name: '__client_uat' },
}
const observe = () => act(async () => onCookieChanged(cookie))
const signOutOnWebsite = () => {
  clerkSession = null
  return observe()
}
const signInAs = (user: string) => {
  clerkUserId = user
  clerkSession = { getToken }
  return observe()
}

const selectWord = (word: string) => {
  const el = screen.getByTestId('sidepanel-sentence')
  const text = el.textContent!
  const start = text.indexOf(word)
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  let acc = 0
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const len = n.textContent!.length
    if (start >= acc && start < acc + len) range.setStart(n, start - acc)
    if (start + word.length > acc && start + word.length <= acc + len) {
      range.setEnd(n, start + word.length - acc)
    }
    acc += len
  }
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
  fireEvent.mouseUp(el)
}

const started = (r: Route) => waitFor(() => expect(r.started).toBe(true))

// One request kind of the panel: how its 'great' request is matched and
// started, and the rows it renders.
type Kind = {
  type: string
  matches: (word: string) => (request: string) => boolean
  start: (word: string) => Promise<void>
  signedOut: (word: string) => string
  error: (word: string) => string
  retry?: (word: string) => string
}

const clickWord = async (word: string) => {
  await screen.findByText('猫是很棒的宠物。')
  selectWord(word)
}

const KINDS: Record<string, Kind> = {
  sentence: {
    type: 'translateSentence',
    matches: sentence => request =>
      request.includes('/api/translate/sentence ') &&
      request.includes(sentence),
    start: async () => {},
    signedOut: () => 'sidepanel-signed-out',
    error: () => 'sidepanel-error',
    retry: () => 'sidepanel-retry-sentence',
  },
  context: {
    type: 'translateWordInContext',
    matches: word => request =>
      request.includes('/api/translate/word-in-context') &&
      request.includes(`"word":"${word}"`),
    start: clickWord,
    signedOut: word => `sidepanel-context-signed-out-${word}`,
    error: word => `sidepanel-context-error-${word}`,
    retry: word => `sidepanel-retry-context-${word}`,
  },
  dictionary: {
    type: 'getOneWord',
    matches: word => request => request.includes(`/api/translate?word=${word}`),
    start: clickWord,
    signedOut: word => `sidepanel-dictionary-signed-out-${word}`,
    error: word => `sidepanel-dictionary-error-${word}`,
  },
}

const expectSignedOutRow = async (kind: Kind, word: string) => {
  const row = await screen.findByTestId(kind.signedOut(word))
  expect(row).toHaveTextContent(SIGNED_OUT)
  expect(
    within(row).getByRole('button', { name: 'Sign in' })
  ).toBeInTheDocument()
  if (kind.retry) expect(screen.queryByTestId(kind.retry(word))).toBeNull()
}

const expectOrdinaryFailure = async (kind: Kind, word: string) => {
  const row = await screen.findByTestId(kind.error(word))
  expect(row).toHaveTextContent(SIGN_IN_CHANGED)
  if (kind.retry)
    expect(screen.getByTestId(kind.retry(word))).toBeInTheDocument()
  expect(screen.queryByTestId(kind.signedOut(word))).toBeNull()
  expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull()
}

beforeEach(() => {
  jest.clearAllMocks()
  __resetClerkClientCacheForTests()
  window.history.replaceState({}, '', `/sidepanel.html?tabId=${PANEL_TAB_ID}`)
  CSS.highlights.clear()
  routes = []
  deliveryGates = new Map()
  answered = new Map()
  pageListeners = new Set()
  ownerWrite = null
  storageListeners = []
  clerkUserId = 'user-a'
  clerkSession = { getToken }
  ;(createClerkClient as jest.Mock).mockImplementation(async () => ({
    get session() {
      return clerkSession
    },
    get user() {
      return clerkSession ? { id: clerkUserId } : null
    },
  }))
  global.fetch = fetchMock as unknown as typeof fetch
  ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({
    [pendingSentenceKey(PANEL_TAB_ID)]: {
      sentence: SENTENCE,
      word: '',
      createdAt: 1,
    },
  })
  ;(chrome.storage.session.set as jest.Mock).mockImplementation(
    async (items: Record<string, unknown>) => {
      if (OWNER_KEY in items && ownerWrite) await ownerWrite
    }
  )
  ;(chrome.storage.local.get as jest.Mock).mockResolvedValue({})
  ;(chrome.storage.onChanged.addListener as jest.Mock).mockImplementation(
    (listener: (changes: unknown, area: string) => void) =>
      storageListeners.push(listener)
  )
  ;(chrome.tabs.query as jest.Mock).mockResolvedValue([])
  ;(chrome.tabs.sendMessage as jest.Mock).mockResolvedValue(undefined)
  // The panel's own listeners, which hear what the worker sends to
  // extension pages.
  ;(chrome.runtime.onMessage.addListener as jest.Mock).mockImplementation(
    (listener: Listener) => pageListeners.add(listener)
  )
  ;(chrome.runtime.onMessage.removeListener as jest.Mock).mockImplementation(
    (listener: Listener) => pageListeners.delete(listener)
  )
  ;(chrome.runtime.sendMessage as jest.Mock).mockImplementation(
    async (message: { action?: string }) => {
      pageListeners.forEach(listener => listener(message, {}, () => {}))
    }
  )
  ;(sendMessageToBackground as jest.Mock).mockImplementation(
    async (message: { type: string }) => {
      const response = await new Promise<{ sessionExpired?: boolean }>(
        resolve => background(message, {}, resolve)
      )
      answered.set(message.type, response)
      await deliveryGates.get(message.type)
      return response
    }
  )
})

describe.each(Object.entries(KINDS))('a %s request', (_name, kind) => {
  const word = kind === KINDS.sentence ? SENTENCE : 'great'

  it('renders an ordinary failure when another account signs in while it is outstanding', async () => {
    const request = hold(kind.matches(word))
    render(<SidePanel />)
    await kind.start('great')
    await started(request.route)

    await signInAs('user-b')
    await act(async () => request.finish(json(200, {})))

    await expectOrdinaryFailure(kind, 'great')
  })

  it('renders an ordinary failure when a sign-in follows a sign-out between classification and delivery', async () => {
    const request = hold(kind.matches(word))
    render(<SidePanel />)
    await kind.start('great')
    await started(request.route)

    const deliver = gateDelivery(kind.type)
    await signOutOnWebsite()
    await act(async () => request.finish(json(200, {})))
    // The background classified it as signed out; the panel has not seen it.
    await waitFor(() =>
      expect(answered.get(kind.type)?.sessionExpired).toBe(true)
    )
    await signInAs('user-b')
    await deliver()

    await expectOrdinaryFailure(kind, 'great')
  })

  it('turns a signed-out row into an ordinary failure once another account signs in', async () => {
    const request = hold(kind.matches(word))
    render(<SidePanel />)
    await kind.start('great')
    await started(request.route)

    await signOutOnWebsite()
    await act(async () => request.finish(json(200, {})))
    await expectSignedOutRow(kind, 'great')

    await signInAs('user-b')

    await expectOrdinaryFailure(kind, 'great')
  })
})

describe('two requests when one gets a confirmed 401', () => {
  // The 401 is confirmed after the force-refreshed retry also gets one.
  const expiredBy = (r: Route) =>
    waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([url, init]) =>
          r.matches(`${url} ${init?.body ?? ''}`)
        )
      ).toHaveLength(2)
    )
  const ownerUpdate = () => {
    const write = deferred<void>()
    ownerWrite = write.promise
    return () => act(async () => write.resolve())
  }

  it('renders both sentence rows signed out', async () => {
    const first = hold(KINDS.sentence.matches(SENTENCE))
    const second = answer401(KINDS.sentence.matches(OTHER_SENTENCE))
    render(<SidePanel />)
    await started(first.route)
    const finishOwnerUpdate = ownerUpdate()

    act(() => {
      storageListeners.forEach(listener =>
        listener(
          {
            [pendingSentenceKey(PANEL_TAB_ID)]: {
              newValue: { sentence: OTHER_SENTENCE, word: '', createdAt: 2 },
            },
          },
          'session'
        )
      )
    })
    await expiredBy(second)
    await act(async () => first.finish(json(200, { chinese: '旧的' })))
    clerkSession = null
    await finishOwnerUpdate()

    await waitFor(() =>
      expect(screen.getAllByTestId('sidepanel-signed-out')).toHaveLength(2)
    )
    screen.getAllByTestId('sidepanel-signed-out').forEach(row => {
      expect(row).toHaveTextContent(SIGNED_OUT)
    })
    expect(screen.getAllByRole('button', { name: 'Sign in' })).toHaveLength(2)
    expect(screen.queryByTestId('sidepanel-retry-sentence')).toBeNull()
  })

  it.each(['context', 'dictionary'])(
    'renders both %s rows signed out',
    async name => {
      const kind = KINDS[name]
      const first = hold(kind.matches('great'))
      const second = answer401(kind.matches('pets'))
      render(<SidePanel />)
      await kind.start('great')
      await started(first.route)
      const finishOwnerUpdate = ownerUpdate()

      selectWord('pets')
      await expiredBy(second)
      await act(async () => first.finish(json(200, {})))
      clerkSession = null
      await finishOwnerUpdate()

      await expectSignedOutRow(kind, 'great')
      await expectSignedOutRow(kind, 'pets')
    }
  )
})
