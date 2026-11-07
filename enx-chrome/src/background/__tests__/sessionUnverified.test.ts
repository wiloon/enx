// #686: a 401 on the forced replay, which carried a freshly minted Clerk
// token, means Clerk still holds the session. The real makeApiRequest and
// message handlers leave the account session alone and flag the one request.
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
jest.mock('@clerk/chrome-extension/client', () => ({
  createClerkClient: jest.fn(),
}))

import { createClerkClient } from '@clerk/chrome-extension/client'
import { makeApiRequest, __resetClerkClientCacheForTests } from '../background'
import { SESSION_UNVERIFIED_MESSAGE } from '@/lib/signedOut'

const onMessage = (chrome.runtime.onMessage.addListener as jest.Mock).mock
  .calls[0][0] as (
  request: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void
) => boolean
const onCookieChanged = (chrome.cookies.onChanged.addListener as jest.Mock).mock
  .calls[0][0] as (change: unknown) => Promise<void>

const OWNER_KEY = 'enx-account-session-owner'
const CACHED_TOKEN = 'cached-token-aaaaaaaa'
const FRESH_TOKEN = 'fresh-token-f7e3c1d9'

type GetTokenOptions = { skipCache?: boolean } | undefined
const getToken = jest.fn<Promise<string | null>, [GetTokenOptions?]>()
let clerkSession: { getToken: typeof getToken } | null
let sessionStorage: Record<string, unknown>

const jsonResponse = (status: number, body: unknown) => ({
  ok: status < 400,
  status,
  statusText: status < 400 ? 'OK' : 'Unauthorized',
  headers: new Headers(),
  json: async () => body,
  text: async () => JSON.stringify(body),
})

const fetchMock = jest.fn()
const answer = (status: (url: string) => number, body: unknown = {}) =>
  fetchMock.mockImplementation(async (url: string) =>
    jsonResponse(status(url), body)
  )

const send = (request: unknown) =>
  new Promise<Record<string, unknown>>(resolve => {
    onMessage(request, {}, resolve as (response: unknown) => void)
  })
const sameUserCookie = {
  cookie: { domain: 'clerk.localhost.test', name: '__client_uat' },
}

beforeEach(async () => {
  jest.clearAllMocks()
  __resetClerkClientCacheForTests()
  getToken.mockImplementation(async options =>
    options?.skipCache ? FRESH_TOKEN : CACHED_TOKEN
  )
  clerkSession = { getToken }
  sessionStorage = {}
  ;(createClerkClient as jest.Mock).mockImplementation(async () => ({
    get session() {
      return clerkSession
    },
    get user() {
      return clerkSession ? { id: 'user-a' } : null
    },
  }))
  ;(chrome.storage.session.get as jest.Mock).mockImplementation(
    async (key: string) => ({ [key]: sessionStorage[key] })
  )
  ;(chrome.storage.session.set as jest.Mock).mockImplementation(
    async (items: Record<string, unknown>) => {
      Object.assign(sessionStorage, items)
    }
  )
  ;(chrome.storage.local.get as jest.Mock).mockResolvedValue({})
  ;(chrome.storage.local.set as jest.Mock).mockResolvedValue(undefined)
  ;(chrome.tabs.query as jest.Mock).mockResolvedValue([{ id: 1 }])
  ;(chrome.tabs.sendMessage as jest.Mock).mockResolvedValue(undefined)
  ;(chrome.runtime.sendMessage as jest.Mock).mockResolvedValue(undefined)
  global.fetch = fetchMock as unknown as typeof fetch
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})

  // The account session knows user-a from an earlier successful request.
  answer(() => 200)
  await makeApiRequest('/api/me')
  expect(sessionStorage[OWNER_KEY]).toBe('user-a')
  fetchMock.mockReset()
})

afterEach(() => jest.restoreAllMocks())

const expectAccountSessionUntouched = () => {
  expect(chrome.tabs.sendMessage).not.toHaveBeenCalled()
  expect(chrome.runtime.sendMessage).not.toHaveBeenCalled()
  expect(sessionStorage[OWNER_KEY]).toBe('user-a')
}

describe('a 401 on the forced replay with a fresh token', () => {
  it('flags the request unverified and leaves the account session alone', async () => {
    answer(() => 401)

    const result = await makeApiRequest('/api/translate?word=fox')

    expect(result).toEqual({
      success: false,
      error: SESSION_UNVERIFIED_MESSAGE,
      sessionUnverified: true,
      accountGeneration: expect.any(Number),
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe(
      `Bearer ${FRESH_TOKEN}`
    )
    expectAccountSessionUntouched()
  })

  it('logs a warning naming the endpoint and the fresh token', async () => {
    answer(() => 401)

    await makeApiRequest('/api/translate?word=fox')

    const warnings = (console.warn as jest.Mock).mock.calls.map(c => c[0])
    expect(warnings).toContainEqual(
      expect.stringMatching(/unverified.*\/api\/translate\?word=fox.*f7e3c1d9/)
    )
    expect(warnings.join('\n')).not.toContain(FRESH_TOKEN)
  })

  it('sends nothing when the next Clerk check sees the same user', async () => {
    answer(() => 401)
    await makeApiRequest('/api/translate?word=fox')

    await onCookieChanged(sameUserCookie)

    expectAccountSessionUntouched()
  })

  it('does not fence a request outstanding at the same time', async () => {
    let finishOther: (response: unknown) => void = () => {}
    let otherStarted: () => void = () => {}
    const otherFetching = new Promise<void>(resolve => {
      otherStarted = resolve
    })
    fetchMock.mockImplementation(async (url: string) => {
      if (!url.endsWith('/other')) return jsonResponse(401, {})
      otherStarted()
      return new Promise(resolve => {
        finishOther = resolve
      })
    })
    const other = makeApiRequest('/other')
    await otherFetching

    await makeApiRequest('/api/translate?word=fox')
    finishOther(jsonResponse(200, { ok: true }))

    expect(await other).toEqual({ success: true, data: { ok: true } })
    expectAccountSessionUntouched()
  })

  it('lets the next request run normally', async () => {
    answer(() => 401)
    await makeApiRequest('/api/translate?word=fox')
    answer(() => 200, { English: 'fox' })

    expect(await makeApiRequest('/api/translate?word=fox')).toEqual({
      success: true,
      data: { English: 'fox' },
    })
  })
})

describe('the side panel freshness check', () => {
  const freshness = () => send({ type: 'panelAccountFreshness' })

  it('reports the account generation the unverified response belongs to', async () => {
    answer(() => 401)

    const response = await send({ type: 'getOneWord', word: 'fox' })

    expect(response.accountGeneration).toEqual(expect.any(Number))
    expect(await freshness()).toEqual({
      sessionLost: false,
      accountGeneration: response.accountGeneration,
    })
  })

  it('reports a new generation once another account signed in', async () => {
    answer(() => 401)
    const response = await send({ type: 'getOneWord', word: 'fox' })

    ;(createClerkClient as jest.Mock).mockImplementation(async () => ({
      session: { getToken },
      user: { id: 'user-b' },
    }))
    await onCookieChanged(sameUserCookie)

    const now = await freshness()
    expect(now.sessionLost).toBe(false)
    expect(now.accountGeneration).not.toBe(response.accountGeneration)
  })
})

describe('the flag through every message handler', () => {
  it.each([
    ['getOneWord', { type: 'getOneWord', word: 'fox' }],
    ['getReviewWords', { type: 'getReviewWords' }],
    ['markKnown', { type: 'markKnown', word: 'fox' }],
    ['translateSentence', { type: 'translateSentence', sentence: 'A fox.' }],
    [
      'translateSentenceWithWord',
      { type: 'translateSentenceWithWord', sentence: 'A fox.', word: 'fox' },
    ],
    [
      'translateWordInContext',
      { type: 'translateWordInContext', sentence: 'A fox.', word: 'fox' },
    ],
    ['defineWordWithAI', { type: 'defineWordWithAI', word: 'fox' }],
  ])('%s returns the unverified flag', async (_name, request) => {
    answer(() => 401)

    const response = await send(request)

    expect(response).toMatchObject({
      success: false,
      sessionUnverified: true,
    })
    expect(response.sessionExpired).toBeFalsy()
    expectAccountSessionUntouched()
  })
})
