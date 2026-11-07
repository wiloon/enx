// #688: when no session token can be minted, the real makeApiRequest decides
// locally and never sends the request to enx-api without one. A confirmed
// signed-out Clerk sync ends the session; anything else is an ordinary
// failure that leaves the account session alone.
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
import { ACCOUNT_CHANGED_MESSAGE } from '@/lib/panelAccountFence'

const OWNER_KEY = 'enx-account-session-owner'
const UNREACHABLE = "Couldn't reach the sign-in service. Please try again."
const EXPIRED = 'Your session has expired. Please login again.'

type GetTokenOptions = { skipCache?: boolean } | undefined
const getToken = jest.fn<Promise<string | null>, [GetTokenOptions?]>()

// How a read of Clerk's client goes after a load came back empty: Clerk's
// Frontend API answers with a signed-out client, the request fails and
// clerk-js swallows it (resolving with no response), or clerk-js throws.
type ClientRead = 'signed-out' | 'swallowed' | 'throws'
type AfterResponse = (
  request: { method?: string; path?: string },
  response?: { ok: boolean; status: number; payload: unknown }
) => unknown

const fakeClerk = (user: string | null, read: ClientRead = 'swallowed') => {
  const afterResponse: AfterResponse[] = []
  return {
    session: user ? { getToken } : null,
    user: user ? { id: user } : null,
    client: {
      reload: async () => {
        if (read === 'throws') throw new Error('ClerkJS: Network error')
        if (read === 'signed-out') {
          afterResponse.forEach(callback =>
            callback(
              { method: 'GET', path: '/client' },
              {
                ok: true,
                status: 200,
                payload: { response: { object: 'client', sessions: [] } },
              }
            )
          )
        }
      },
    },
    __internal_onAfterResponse: (callback: AfterResponse) => {
      afterResponse.push(callback)
    },
  }
}

// Each Clerk load (createClerkClient call) takes the next scripted client;
// the last one repeats.
let loads: Array<() => Promise<unknown>>
const loadCount = () => (createClerkClient as jest.Mock).mock.calls.length
const loadsAs = (...script: Array<() => Promise<unknown>>) => {
  loads = script
}
const signedIn =
  (user = 'user-a') =>
  async () =>
    fakeClerk(user)
const empty = (read: ClientRead) => async () => fakeClerk(null, read)
const failing = () => async () => {
  throw new Error('ClerkJS: Network error at /v1/client')
}

let sessionStorage: Record<string, unknown>
const fetchMock = jest.fn()
const jsonResponse = (status: number, body: unknown) => ({
  ok: status < 400,
  status,
  statusText: status < 400 ? 'OK' : 'Unauthorized',
  headers: new Headers(),
  json: async () => body,
  text: async () => JSON.stringify(body),
})
const answer = (status: number, body: unknown = {}) =>
  fetchMock.mockImplementation(async () => jsonResponse(status, body))

const authorizations = () =>
  fetchMock.mock.calls.map(
    ([, init]) =>
      (init as RequestInit & { headers: Record<string, string> }).headers
        .Authorization
  )

beforeEach(async () => {
  jest.clearAllMocks()
  __resetClerkClientCacheForTests()
  sessionStorage = {}
  getToken.mockReset()
  getToken.mockResolvedValue('clerk-session-jwt')
  loadsAs(signedIn())
  ;(createClerkClient as jest.Mock).mockImplementation(() => {
    const n = (createClerkClient as jest.Mock).mock.calls.length
    return loads[Math.min(n, loads.length) - 1]()
  })
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

  // The account session knows user-a from an earlier successful request;
  // then the worker starts over (an MV3 eviction) with no Clerk client.
  answer(200)
  await makeApiRequest('/api/me')
  expect(sessionStorage[OWNER_KEY]).toBe('user-a')
  __resetClerkClientCacheForTests()
  fetchMock.mockReset()
  getToken.mockClear()
  ;(createClerkClient as jest.Mock).mockClear()
  ;(chrome.tabs.sendMessage as jest.Mock).mockClear()
  ;(chrome.runtime.sendMessage as jest.Mock).mockClear()
  ;(chrome.storage.session.set as jest.Mock).mockClear()
})

afterEach(() => {
  // Across every test: nothing reaches enx-api without a token.
  for (const authorization of authorizations()) {
    expect(authorization).toMatch(/^Bearer \S+$/)
  }
  jest.restoreAllMocks()
})

// The worker log's decision lines, one per request that got no token.
const noTokenLines = () =>
  [
    ...(console.warn as jest.Mock).mock.calls,
    ...(console.error as jest.Mock).mock.calls,
  ]
    .map(c => String(c[0]))
    .filter(line => line.includes('no session token'))

const expectTransient = (result: unknown) => {
  expect(result).toEqual({ success: false, error: UNREACHABLE })
  expect(chrome.tabs.sendMessage).not.toHaveBeenCalled()
  expect(chrome.runtime.sendMessage).not.toHaveBeenCalled()
  expect(chrome.storage.session.set).not.toHaveBeenCalledWith(
    expect.objectContaining({ [OWNER_KEY]: expect.anything() })
  )
  expect(sessionStorage[OWNER_KEY]).toBe('user-a')
}

describe('a Clerk sync that cannot confirm the session', () => {
  it('is transient when the load itself throws', async () => {
    loadsAs(failing())
    answer(200)

    const result = await makeApiRequest('/api/translate?word=fox')

    expect(fetchMock).not.toHaveBeenCalled()
    expectTransient(result)
  })

  it('is transient when the load comes back empty after a Frontend API network failure', async () => {
    loadsAs(empty('swallowed'))
    answer(200)

    const result = await makeApiRequest('/api/translate?word=fox')

    expect(fetchMock).not.toHaveBeenCalled()
    expectTransient(result)
  })

  it('is transient when the read of the client throws', async () => {
    loadsAs(empty('throws'))
    answer(200)

    const result = await makeApiRequest('/api/translate?word=fox')

    expect(fetchMock).not.toHaveBeenCalled()
    expectTransient(result)
  })

  it('lets the next request start clean and ask Clerk again', async () => {
    loadsAs(empty('swallowed'))
    await makeApiRequest('/api/translate?word=fox')
    loadsAs(signedIn())
    answer(200, { English: 'fox' })

    expect(await makeApiRequest('/api/translate?word=fox')).toEqual({
      success: true,
      data: { English: 'fox' },
    })
  })
})

describe('a Clerk sync that confirms the session is gone', () => {
  it('takes the session-loss path without recheck loads beyond the sync retries', async () => {
    loadsAs(empty('signed-out'))
    answer(200)

    const result = await makeApiRequest('/api/translate?word=fox')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result).toEqual({
      success: false,
      error: EXPIRED,
      sessionExpired: true,
    })
    // The first load and its three retries, nothing more.
    expect(loadCount()).toBe(4)
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(1, {
      action: 'sessionExpired',
      cause: 'signed-out',
    })
    expect(sessionStorage[OWNER_KEY]).toBeNull()
  })

  it('expires the session when no signed-in owner was known', async () => {
    sessionStorage = {}
    __resetClerkClientCacheForTests()
    loadsAs(empty('signed-out'))

    const result = await makeApiRequest('/api/translate?word=fox')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result).toMatchObject({ success: false, sessionExpired: true })
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(1, {
      action: 'sessionExpired',
      cause: 'expired',
    })
  })
})

describe('a session whose token mints all fail', () => {
  beforeEach(() => getToken.mockResolvedValue(null))

  it('ends the session when the recheck finds no session', async () => {
    loadsAs(signedIn(), empty('signed-out'))
    answer(200)

    const result = await makeApiRequest('/api/translate?word=fox')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result).toEqual({
      success: false,
      error: EXPIRED,
      sessionExpired: true,
    })
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(1, {
      action: 'sessionExpired',
      cause: 'signed-out',
    })
    expect(noTokenLines()).toEqual([
      expect.stringMatching(/sync=present, recheck=absent.*-> session-loss/),
    ])
  })

  it('is transient when the recheck still finds a session but its fresh mint fails', async () => {
    answer(200)

    const result = await makeApiRequest('/api/translate?word=fox')

    expect(fetchMock).not.toHaveBeenCalled()
    expectTransient(result)
    // Three cached mints, then one fresh mint after the recheck.
    expect(getToken).toHaveBeenCalledTimes(4)
    expect(getToken).toHaveBeenLastCalledWith({ skipCache: true })
    expect(loadCount()).toBe(2)
  })

  it('is transient when the recheck itself throws', async () => {
    loadsAs(signedIn(), failing())
    answer(200)

    const result = await makeApiRequest('/api/translate?word=fox')

    expect(fetchMock).not.toHaveBeenCalled()
    expectTransient(result)
  })

  it("is transient when getToken() throws Clerk's offline network_error", async () => {
    getToken.mockRejectedValue(
      Object.assign(new Error('ClerkJS: Network error'), {
        code: 'network_error',
      })
    )
    answer(200)

    const result = await makeApiRequest('/api/translate?word=fox')

    expect(fetchMock).not.toHaveBeenCalled()
    expectTransient(result)
  })

  it('continues the request when the fresh mint after the recheck succeeds', async () => {
    getToken.mockImplementation(async options =>
      options?.skipCache ? 'fresh-token' : null
    )
    answer(200, { English: 'fox' })

    const result = await makeApiRequest('/api/translate?word=fox')

    expect(result).toEqual({ success: true, data: { English: 'fox' } })
    expect(authorizations()).toEqual(['Bearer fresh-token'])
    expect(loadCount()).toBe(2)
  })

  it('sends nothing when the recheck observes another account', async () => {
    loadsAs(signedIn(), async () => ({
      ...fakeClerk('user-b'),
      session: { getToken: async () => 'user-b-token' },
    }))
    answer(200)

    const result = await makeApiRequest('/api/translate?word=fox')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result).toEqual({ success: false, error: ACCOUNT_CHANGED_MESSAGE })
  })

  it('shares one recheck among requests that fail to mint at once', async () => {
    answer(200)

    const results = await Promise.all([
      makeApiRequest('/api/translate?word=fox'),
      makeApiRequest('/api/translate?word=cat'),
      makeApiRequest('/api/me/review-words'),
    ])

    for (const result of results) {
      expect(result).toEqual({ success: false, error: UNREACHABLE })
    }
    // One shared first sync, then one shared recheck.
    expect(loadCount()).toBe(2)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('logs one line with the endpoint, the failed mints and the recheck result', async () => {
    getToken.mockRejectedValue(new Error('clerk offline'))
    loadsAs(signedIn(), empty('swallowed'))

    await makeApiRequest('/api/translate?word=fox')

    const lines = noTokenLines()
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/GET \/api\/translate\?word=fox/)
    expect(lines[0]).toMatch(/3 failed getToken\(\) attempts/)
    expect(lines[0]).toMatch(/last error: Error: clerk offline/)
    expect(lines[0]).toMatch(/sync=present/)
    expect(lines[0]).toMatch(/recheck=unconfirmed/)
    expect(lines[0]).toMatch(/transient/)
  })
})

describe('the forced replay after a 401', () => {
  it('never replays without a token, and the recheck decides', async () => {
    getToken.mockImplementation(async options =>
      options?.skipCache ? null : 'cached-token'
    )
    answer(401)

    const result = await makeApiRequest('/api/translate?word=fox')

    expect(authorizations()).toEqual(['Bearer cached-token'])
    expectTransient(result)
  })

  it('replays once with the recheck’s fresh token and never again', async () => {
    let freshMints = 0
    getToken.mockImplementation(async options => {
      if (!options?.skipCache) return 'cached-token'
      // The three forced mints fail; the one after the recheck succeeds.
      return ++freshMints > 3 ? 'fresh-token' : null
    })
    answer(401)

    const result = await makeApiRequest('/api/translate?word=fox')

    expect(authorizations()).toEqual([
      'Bearer cached-token',
      'Bearer fresh-token',
    ])
    expect(result).toMatchObject({ success: false, sessionUnverified: true })
  })
})
