// #686: real background responses driven through the side panel. A request
// enx-api refused even with a freshly minted Clerk token renders the
// unverified row with Retry and Sign in, only on the row that asked. A switch
// to another signed-in account supersedes it; the same account never does.
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
const UNVERIFIED =
  "We couldn't verify your sign-in. Try again, or sign in again."
const SIGN_IN_CHANGED =
  'Your sign-in changed while this was loading. Please try again.'

const getToken = jest.fn(async () => 'clerk-session-jwt')
let clerkUserId = 'user-a'

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
type Route = {
  matches: (request: string) => boolean
  respond: () => Promise<unknown>
}
let routes: Route[]
const answer = (
  matches: (request: string) => boolean,
  status: number,
  body: unknown = {}
) => {
  const r = { matches, respond: async () => json(status, body) }
  routes.push(r)
  return () => {
    routes = routes.filter(x => x !== r)
  }
}

const fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
  const request = `${url} ${init?.body ?? ''}`
  const r = routes.find(r => r.matches(request))
  if (r) return r.respond()
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
const fetchesOf = (matches: (request: string) => boolean) =>
  fetchMock.mock.calls.filter(([url, init]) =>
    matches(`${url} ${init?.body ?? ''}`)
  ).length

// Responses wait here, after the background has classified them, until the
// test lets the panel receive them.
let deliveryGates: Map<string, Promise<void>>
let answered: Map<string, { sessionUnverified?: boolean }>
const gateDelivery = (type: string) => {
  const gate = deferred<void>()
  deliveryGates.set(type, gate.promise)
  return () => act(async () => gate.resolve())
}

let pageListeners: Set<Listener>
let ownerWrite: Promise<void> | null

const cookie = {
  cookie: { domain: 'clerk.localhost.test', name: '__client_uat' },
}
const observe = () => act(async () => onCookieChanged(cookie))
const signInAs = (user: string) => {
  clerkUserId = user
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

const clickGreat = async () => {
  await screen.findByText('猫是很棒的宠物。')
  selectWord('great')
}

// One request kind of the panel: how its request is matched and started,
// the rows it renders, and what it shows once it succeeds.
type Kind = {
  type: string
  matches: (request: string) => boolean
  start: () => Promise<void>
  unverified: string
  error: string
  retry?: string
  loaded: () => Promise<unknown>
}

const KINDS: Record<string, Kind> = {
  sentence: {
    type: 'translateSentence',
    matches: request =>
      request.includes('/api/translate/sentence ') &&
      request.includes(SENTENCE),
    start: async () => {},
    unverified: 'sidepanel-unverified',
    error: 'sidepanel-error',
    retry: 'sidepanel-retry-sentence',
    loaded: () => screen.findByText('猫是很棒的宠物。'),
  },
  context: {
    type: 'translateWordInContext',
    matches: request =>
      request.includes('/api/translate/word-in-context') &&
      request.includes('"word":"great"'),
    start: clickGreat,
    unverified: 'sidepanel-context-unverified-great',
    error: 'sidepanel-context-error-great',
    retry: 'sidepanel-retry-context-great',
    loaded: () =>
      waitFor(() =>
        expect(screen.getByTestId('sidepanel-card-great')).toHaveTextContent(
          '很棒的'
        )
      ),
  },
  dictionary: {
    type: 'getOneWord',
    matches: request => request.includes('/api/translate?word=great'),
    start: clickGreat,
    unverified: 'sidepanel-dictionary-unverified-great',
    error: 'sidepanel-dictionary-error-great',
    loaded: () =>
      waitFor(() =>
        expect(screen.getByTestId('sidepanel-card-great')).toHaveTextContent(
          '大的'
        )
      ),
  },
}

const expectUnverifiedRow = async (kind: Kind) => {
  const row = await screen.findByTestId(kind.unverified)
  expect(row).toHaveTextContent(UNVERIFIED)
  expect(
    within(row)
      .getAllByRole('button')
      .map(b => b.textContent)
  ).toEqual(['Retry', 'Sign in'])
  expect(screen.queryByTestId(kind.error)).toBeNull()
  return row
}

const expectOrdinaryFailure = async (kind: Kind, message: string) => {
  const row = await screen.findByTestId(kind.error)
  expect(row).toHaveTextContent(message)
  if (kind.retry) expect(screen.getByTestId(kind.retry)).toBeInTheDocument()
  expect(screen.queryByTestId(kind.unverified)).toBeNull()
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
  clerkUserId = 'user-a'
  ;(createClerkClient as jest.Mock).mockImplementation(async () => ({
    session: { getToken },
    user: { id: clerkUserId },
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
    () => {}
  )
  ;(chrome.tabs.query as jest.Mock).mockResolvedValue([])
  ;(chrome.tabs.sendMessage as jest.Mock).mockResolvedValue(undefined)
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
      const response = await new Promise<{ sessionUnverified?: boolean }>(
        resolve => background(message, {}, resolve)
      )
      answered.set(message.type, response)
      await deliveryGates.get(message.type)
      return response
    }
  )
})

const classified = (kind: Kind) =>
  waitFor(() => expect(answered.get(kind.type)?.sessionUnverified).toBe(true))

describe.each(Object.entries(KINDS))('an unverified %s request', (_, kind) => {
  it('renders the unverified row, and Retry re-sends that row’s request', async () => {
    const recover = answer(kind.matches, 401)
    render(<SidePanel />)
    await kind.start()
    await expectUnverifiedRow(kind)
    const sent = fetchesOf(kind.matches)
    recover()

    fireEvent.click(screen.getByTestId(`${kind.unverified}-retry`))

    await kind.loaded()
    expect(fetchesOf(kind.matches)).toBe(sent + 1)
    expect(screen.queryByTestId(kind.unverified)).toBeNull()
  })

  it('starts the web sign-in from Sign in', async () => {
    answer(kind.matches, 401)
    render(<SidePanel />)
    await kind.start()
    const row = await expectUnverifiedRow(kind)

    fireEvent.click(within(row).getByRole('button', { name: 'Sign in' }))

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      action: 'openWebSignIn',
    })
  })

  it('shows an ordinary failure after a Retry that fails for another reason', async () => {
    const recover = answer(kind.matches, 401)
    render(<SidePanel />)
    await kind.start()
    await expectUnverifiedRow(kind)
    recover()
    // Not a 5xx: the lookup's own retries would outlast the query timeout.
    answer(kind.matches, 400, { message: 'Request refused' })

    fireEvent.click(screen.getByTestId(`${kind.unverified}-retry`))

    await expectOrdinaryFailure(kind, 'Request refused')
  })

  it('keeps the unverified row through Clear and Undo', async () => {
    answer(kind.matches, 401)
    render(<SidePanel />)
    await kind.start()
    await expectUnverifiedRow(kind)

    fireEvent.click(screen.getByTestId('sidepanel-clear-all'))
    fireEvent.click(screen.getByTestId('sidepanel-undo-clear'))

    await expectUnverifiedRow(kind)
  })

  it('turns the unverified row into an ordinary failure once another account signs in', async () => {
    answer(kind.matches, 401)
    render(<SidePanel />)
    await kind.start()
    await expectUnverifiedRow(kind)

    await signInAs('user-b')

    await expectOrdinaryFailure(kind, SIGN_IN_CHANGED)
  })

  it('supersedes a response another account signed in after, before the panel heard of it', async () => {
    answer(kind.matches, 401)
    render(<SidePanel />)
    const deliver = gateDelivery(kind.type)
    await kind.start()
    await classified(kind)

    // The worker's fence advances at once; its notification waits for the
    // owner write.
    const write = deferred<void>()
    ownerWrite = write.promise
    clerkUserId = 'user-b'
    const switching = onCookieChanged(cookie)
    await waitFor(() =>
      expect(chrome.storage.session.set).toHaveBeenCalledWith({
        [OWNER_KEY]: 'user-b',
      })
    )
    await deliver()

    await expectOrdinaryFailure(kind, SIGN_IN_CHANGED)
    await act(async () => {
      write.resolve()
      await switching
    })
  })

  it('stays unverified when the same account is observed before delivery', async () => {
    answer(kind.matches, 401)
    render(<SidePanel />)
    const deliver = gateDelivery(kind.type)
    await kind.start()
    await classified(kind)

    await observe()
    await deliver()

    await expectUnverifiedRow(kind)
  })
})
