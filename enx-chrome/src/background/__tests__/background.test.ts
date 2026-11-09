// Avoid loading the real env.ts (uses `import.meta`, which ts-jest can't parse
// under CommonJS).
jest.mock('@/config/env', () => ({
  config: {
    apiBaseUrl: 'http://localhost:8090',
    frontendBaseUrl: 'http://localhost:3000',
    clerkPublishableKey: 'pk_test_x',
    // Deliberately not the website origin: in production the sync host is
    // Clerk's Frontend API (clerk.catglish.com), and the sign-in tab must still
    // go to the website.
    clerkSyncHost: 'https://clerk.localhost.test',
    uiOrigins: [
      'http://localhost:3000',
      'https://enx.wiloon.lab',
      'https://enx.wiloon.com',
    ],
    environment: 'test',
  },
}))

// Fake Clerk client (ADR-015): the background mints a session JWT via
// clerk.session.getToken(). `setClerkSession` controls what it returns.
const getToken = jest.fn<Promise<string | null>, [{ skipCache?: boolean }?]>()
let clerkUserId = 'user-a'
let clerkSession: { getToken: typeof getToken } | null = { getToken }

// Re-installed on every setClerkSession() call because it runs after each
// describe block's jest.resetAllMocks(), which wipes mockImplementation --
// see the "Captured at import time" comment below for the same gotcha.
function installCreateClerkClientMock() {
  ;(createClerkClient as jest.Mock).mockImplementation(async () =>
    fakeClerkClient()
  )
}

// With no session, a read of the client gets Clerk's Frontend API answer: a
// signed-out client, which confirms the session is gone (#688).
type AfterResponse = (
  request: { method: string; path: string },
  response: { ok: boolean; payload: unknown }
) => void
function fakeClerkClient(
  session: () => typeof clerkSession = () => clerkSession
) {
  const afterResponse: AfterResponse[] = []
  return {
    get session() {
      return session()
    },
    get user() {
      return session() ? { id: clerkUserId } : null
    },
    client: {
      reload: async () => {
        if (session()) return
        afterResponse.forEach(callback =>
          callback(
            { method: 'GET', path: '/client' },
            { ok: true, payload: { response: null } }
          )
        )
      },
    },
    __internal_onAfterResponse: (callback: AfterResponse) => {
      afterResponse.push(callback)
    },
  }
}

function setClerkSession(token: string | null) {
  installCreateClerkClientMock()
  if (token === null) {
    clerkSession = null
  } else {
    clerkSession = { getToken }
    getToken.mockResolvedValue(token)
  }
}

// A real expiry: the force-refreshed mint gets no token, and the recheck
// that follows finds Clerk signed out, so no replay goes out (#688). A replay
// that carried a fresh token is an unverified session instead (#686,
// sessionUnverified.test.ts).
function expireOnForcedMint() {
  getToken.mockImplementation(async options => {
    if (!options?.skipCache) return 'clerk-session-jwt'
    clerkSession = null
    return null
  })
}

jest.mock('@clerk/chrome-extension/client', () => ({
  createClerkClient: jest.fn(),
}))

import { createClerkClient } from '@clerk/chrome-extension/client'
import { TOGGLE_LEARNING_MODE_COMMAND } from '@/lib/learningModeCommand'
import {
  makeApiRequest,
  NETWORK_ERROR_MESSAGE,
  SERVICE_UNAVAILABLE_MESSAGE,
  handleGetReviewWords,
  SESSION_SYNC_RETRY_DELAYS_MS,
  __resetClerkClientCacheForTests,
} from '../background'

// Captured at import time, before any test's resetAllMocks() wipes the
// addListener call history: importing ../background registers this as a
// top-level side effect.
const onMessageListener = (chrome.runtime.onMessage.addListener as jest.Mock)
  .mock.calls[0][0] as (
  request: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void
) => boolean

const onCookieChanged = (chrome.cookies.onChanged.addListener as jest.Mock).mock
  .calls[0]?.[0]

// ADR-019: the one web -> extension channel. enx-ui (an externally_connectable
// origin) is the only caller.
const onMessageExternalListener = (
  chrome.runtime.onMessageExternal.addListener as jest.Mock
).mock.calls[0][0] as (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void
) => boolean | void

function jsonResponse(
  status: number,
  body: unknown,
  ok = status < 400,
  headers: Record<string, string> = {}
) {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Unauthorized',
    headers: new Headers(headers),
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  }
}

beforeEach(() => {
  __resetClerkClientCacheForTests()
  clerkUserId = 'user-a'
})

describe('background makeApiRequest / Clerk session token', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    setClerkSession('clerk-session-jwt')
    ;(chrome.storage.local.remove as jest.Mock).mockResolvedValue(undefined)
    ;(chrome.tabs.query as jest.Mock).mockResolvedValue([{ id: 1 }])
    ;(chrome.tabs.sendMessage as jest.Mock).mockResolvedValue(undefined)
    ;(global.fetch as jest.Mock) = jest.fn()
  })

  it('attaches the Clerk session token as a Bearer header', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse(200, { English: 'test' })
    )

    const result = await makeApiRequest('/api/translate?word=test')

    expect(result).toEqual({ success: true, data: { English: 'test' } })
    const [, requestInit] = (global.fetch as jest.Mock).mock.calls[0]
    expect(requestInit.headers.Authorization).toBe('Bearer clerk-session-jwt')
  })

  it('sends nothing when Clerk confirms there is no session', async () => {
    setClerkSession(null)
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(jsonResponse(200, {}))

    const result = await makeApiRequest('/api/me')

    expect(result).toMatchObject({ success: false, sessionExpired: true })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('force-refreshes the token once on a 401, then reports session-expired when Clerk is signed out', async () => {
    expireOnForcedMint()
    ;(global.fetch as jest.Mock).mockResolvedValue(jsonResponse(401, {}))

    const result = await makeApiRequest('/api/translate?word=test')

    expect(result).toEqual({
      success: false,
      error: 'Your session has expired. Please login again.',
      sessionExpired: true,
    })
    // Only the cached token went out: the forced mint got none, and the
    // recheck found Clerk signed out.
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(getToken).toHaveBeenNthCalledWith(2, { skipCache: true })
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ action: 'sessionExpired' })
    )
  })

  it('invalidates every tab after a confirmed session loss, even if one has no content script', async () => {
    ;(chrome.tabs.query as jest.Mock).mockImplementation(async query =>
      query.active ? [{ id: 1 }] : [{ id: 1 }, { id: 2 }, { id: 3 }]
    )
    ;(chrome.tabs.sendMessage as jest.Mock).mockImplementation(async id => {
      if (id === 2) throw new Error('Receiving end does not exist')
    })
    expireOnForcedMint()
    ;(global.fetch as jest.Mock).mockResolvedValue(jsonResponse(401, {}))

    expect(await makeApiRequest('/api/me')).toMatchObject({
      sessionExpired: true,
    })
    for (const id of [1, 2, 3]) {
      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
        id,
        expect.objectContaining({ action: 'sessionExpired' })
      )
    }
  })

  it('invalidates every tab when the popup reports a completed sign-out', async () => {
    ;(chrome.tabs.query as jest.Mock).mockResolvedValue([{ id: 1 }, { id: 2 }])
    const result = await new Promise(resolve =>
      onMessageListener({ type: 'accountSignedOut' }, {}, resolve)
    )
    expect(result).toEqual({ success: true })
    for (const id of [1, 2]) {
      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(id, {
        action: 'accountChanged',
      })
    }
  })

  it('invalidates a cached page when an API call observes a different account', async () => {
    __resetClerkClientCacheForTests()
    clerkUserId = 'user-a'
    ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({})
    ;(chrome.storage.session.set as jest.Mock).mockResolvedValue(undefined)
    ;(global.fetch as jest.Mock).mockImplementation(async () =>
      jsonResponse(200, {})
    )
    await makeApiRequest('/api/me')
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled()

    clerkUserId = 'user-b'
    await makeApiRequest('/api/me')
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(1, {
      action: 'accountChanged',
    })
    clerkUserId = 'user-a'
  })

  it('tells every tab a signed-in user signed out when the recheck after a 401 finds Clerk signed out', async () => {
    expireOnForcedMint()
    ;(global.fetch as jest.Mock).mockResolvedValue(jsonResponse(401, {}))

    await makeApiRequest('/api/me')

    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(1, {
      action: 'sessionExpired',
      cause: 'signed-out',
    })
  })

  it('reports a signed-in user observed as signed out as a session loss, not an account change', async () => {
    ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({})
    ;(global.fetch as jest.Mock).mockResolvedValue(jsonResponse(200, {}))
    await makeApiRequest('/api/me')
    setClerkSession(null)

    const result = await makeApiRequest('/api/me/review-words')

    expect(result).toMatchObject({ success: false, sessionExpired: true })
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(1, {
      action: 'sessionExpired',
      cause: 'signed-out',
    })
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalledWith(1, {
      action: 'accountChanged',
    })
  })

  it('classifies a request fenced by another request’s 401 as signed out, before the owner update finishes', async () => {
    ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({})
    ;(global.fetch as jest.Mock).mockResolvedValue(jsonResponse(200, {}))
    await makeApiRequest('/api/me')
    expireOnForcedMint()

    let finishOther: (response: unknown) => void = () => {}
    let otherStarted: () => void = () => {}
    const otherFetching = new Promise<void>(resolve => {
      otherStarted = resolve
    })
    ;(global.fetch as jest.Mock).mockImplementation(async (url: string) => {
      if (!url.endsWith('/other')) return jsonResponse(401, {})
      otherStarted()
      return new Promise(resolve => {
        finishOther = resolve
      })
    })
    let finishOwnerWrite: () => void = () => {}
    ;(chrome.storage.session.set as jest.Mock).mockImplementation(
      () =>
        new Promise<void>(resolve => {
          finishOwnerWrite = resolve
        })
    )

    const other = makeApiRequest('/other')
    await otherFetching
    const expiring = makeApiRequest('/expiring')
    await new Promise(resolve => setTimeout(resolve, 0))
    finishOther(jsonResponse(200, {}))
    expect(await other).toMatchObject({ success: false, sessionExpired: true })

    finishOwnerWrite()
    expect(await expiring).toMatchObject({
      success: false,
      sessionExpired: true,
    })
  })

  // #743: a sign-in rewrites Clerk's cookies several times in a row. The
  // debounce runs in tests too, so every test here moves the clock itself.
  describe('website session cookie changes', () => {
    // Each sign-in, sign-out or switch gives `__client_uat` a new value.
    let clientUat = 0
    const changeSessionCookie = (
      value = `uat-${++clientUat}`,
      removal: { removed: boolean; cause?: string } = { removed: false }
    ): Promise<void> =>
      onCookieChanged({
        cookie: {
          domain: 'clerk.localhost.test',
          name: '__client_uat',
          value,
        },
        ...removal,
      })
    const loads = () => (createClerkClient as jest.Mock).mock.calls.length
    const holdNextFetch = () => {
      let finish: (response: unknown) => void = () => {}
      let started: () => void = () => {}
      const fetching = new Promise<void>(resolve => {
        started = resolve
      })
      ;(global.fetch as jest.Mock).mockImplementationOnce(() => {
        started()
        return new Promise(resolve => {
          finish = resolve
        })
      })
      return { fetching, finish: (response: unknown) => finish(response) }
    }
    const holdNextLoad = () => {
      let release: (client: unknown) => void = () => {}
      ;(createClerkClient as jest.Mock).mockImplementationOnce(
        () =>
          new Promise(resolve => {
            release = resolve
          })
      )
      return (client: unknown) => release(client)
    }

    beforeEach(() => {
      jest.useFakeTimers()
      ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({})
      ;(global.fetch as jest.Mock).mockResolvedValue(jsonResponse(200, {}))
    })
    afterEach(() => jest.useRealTimers())

    it('detects a website account switch from its session cookie without a page API request', async () => {
      await makeApiRequest('/api/me')
      ;(chrome.tabs.sendMessage as jest.Mock).mockClear()
      clerkUserId = 'user-b'
      const check = changeSessionCookie()
      await jest.advanceTimersByTimeAsync(1000)
      await check
      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(1, {
        action: 'accountChanged',
      })
      expect(global.fetch).toHaveBeenCalledTimes(1)
    })

    it('keeps the review list when the same account refreshes its session cookie', async () => {
      await makeApiRequest('/api/me')
      const check = changeSessionCookie()
      await jest.advanceTimersByTimeAsync(1000)
      await check
      expect(chrome.tabs.sendMessage).not.toHaveBeenCalled()
    })

    it.each([
      ['unrelated.test', '__client_uat', false, 'explicit'],
      ['clerk.localhost.test', 'preferences', false, 'explicit'],
      ['clerk.localhost.test', '__client_uat', true, 'overwrite'],
    ])(
      'ignores a cookie event for %s / %s / removed=%s / %s',
      async (domain, name, removed, cause) => {
        await onCookieChanged({ cookie: { domain, name }, removed, cause })
        await jest.advanceTimersByTimeAsync(2000)
        expect(createClerkClient).not.toHaveBeenCalled()
        expect(chrome.tabs.sendMessage).not.toHaveBeenCalled()
      }
    )

    // The website's Clerk rewrites its cookies every second or so with the
    // values they already hold: a removal by an expired overwrite, then a set.
    it('loads nothing when a burst rewrites the session cookies with the values they had', async () => {
      await makeApiRequest('/api/me')
      let check = changeSessionCookie('uat-signed-in')
      await jest.advanceTimersByTimeAsync(1000)
      await check
      const loadsBefore = loads()

      for (let i = 0; i < 3; i++) {
        check = changeSessionCookie('uat-signed-in', {
          removed: true,
          cause: 'expired_overwrite',
        })
        const set = changeSessionCookie('uat-signed-in')
        await jest.advanceTimersByTimeAsync(1500)
        await Promise.all([check, set])
      }

      expect(loads()).toBe(loadsBefore)
      expect(await makeApiRequest('/api/me')).toEqual({
        success: true,
        data: {},
      })
      expect(loads()).toBe(loadsBefore)
    })

    it('rebuilds the client when a session cookie is removed and not set again', async () => {
      await makeApiRequest('/api/me')
      let check = changeSessionCookie('uat-signed-in')
      await jest.advanceTimersByTimeAsync(1000)
      await check
      const loadsBefore = loads()

      check = changeSessionCookie('uat-signed-in', {
        removed: true,
        cause: 'explicit',
      })
      await jest.advanceTimersByTimeAsync(1000)
      await check

      expect(loads()).toBe(loadsBefore + 1)
    })

    it('loads the client once, a second after a burst of changes goes quiet', async () => {
      const checks: Promise<void>[] = []
      for (let i = 0; i < 5; i++) {
        checks.push(changeSessionCookie())
        await jest.advanceTimersByTimeAsync(200)
      }
      // The last change came at 800 ms.
      await jest.advanceTimersByTimeAsync(799)
      expect(loads()).toBe(0)
      await jest.advanceTimersByTimeAsync(1)
      expect(loads()).toBe(1)
      await Promise.all(checks)
      expect(loads()).toBe(1)
    })

    it('starts the load 2 s after the first change while changes keep coming', async () => {
      const checks = [changeSessionCookie()]
      for (let i = 0; i < 3; i++) {
        await jest.advanceTimersByTimeAsync(500)
        checks.push(changeSessionCookie())
      }
      await jest.advanceTimersByTimeAsync(499)
      expect(loads()).toBe(0)
      await jest.advanceTimersByTimeAsync(1)
      expect(loads()).toBe(1)
      await Promise.all(checks)
    })

    it('spends one load plus the retries on a settled burst with no session', async () => {
      setClerkSession(null)
      const checks = [
        changeSessionCookie(),
        changeSessionCookie(),
        changeSessionCookie(),
      ]
      await jest.advanceTimersByTimeAsync(1000)
      await Promise.all(checks)
      expect(loads()).toBe(1 + SESSION_SYNC_RETRY_DELAYS_MS.length)
    })

    it('folds changes during an empty-session sync into one follow-up that answers its waiting callers', async () => {
      setClerkSession(null)
      const releaseFirst = holdNextLoad()
      const first = changeSessionCookie()
      await jest.advanceTimersByTimeAsync(1000)
      expect(loads()).toBe(1)

      const request = makeApiRequest('/api/me')
      const later = [
        changeSessionCookie(),
        changeSessionCookie(),
        changeSessionCookie(),
      ]
      await jest.advanceTimersByTimeAsync(2000)
      expect(loads()).toBe(1)
      releaseFirst(fakeClerkClient())
      await Promise.all([first, ...later])

      const cycle = 1 + SESSION_SYNC_RETRY_DELAYS_MS.length
      expect(loads()).toBeGreaterThan(1)
      expect(loads()).toBeLessThanOrEqual(2 * cycle)
      expect(await request).toMatchObject({
        success: false,
        sessionExpired: true,
      })
      expect(loads()).toBeLessThanOrEqual(2 * cycle)
      expect(global.fetch).not.toHaveBeenCalled()
    })

    it('holds a request made right after an account switch until the new account is loaded', async () => {
      await makeApiRequest('/api/me')
      ;(global.fetch as jest.Mock).mockClear()
      const loadsBefore = loads()
      clerkUserId = 'user-b'
      ;(createClerkClient as jest.Mock).mockImplementation(async () => ({
        user: { id: 'user-b' },
        session: { getToken: async () => 'user-b-jwt' },
      }))

      const check = changeSessionCookie()
      const request = makeApiRequest('/api/me')
      await jest.advanceTimersByTimeAsync(999)
      expect(global.fetch).not.toHaveBeenCalled()
      await jest.advanceTimersByTimeAsync(1)
      await check

      expect(await request).toEqual({ success: true, data: {} })
      expect(loads()).toBe(loadsBefore + 1)
      expect(global.fetch).toHaveBeenCalledTimes(1)
      const [, requestInit] = (global.fetch as jest.Mock).mock.calls[0]
      expect(requestInit.headers.Authorization).toBe('Bearer user-b-jwt')
    })

    it('loads once more after changes during a load, and keeps the newest website identity', async () => {
      await makeApiRequest('/api/me')
      const releaseFirst = holdNextLoad()
      ;(createClerkClient as jest.Mock).mockResolvedValue({
        user: { id: 'user-c' },
        session: { getToken },
      })
      const loadsBefore = loads()
      const first = changeSessionCookie()
      await jest.advanceTimersByTimeAsync(1000)
      const later = [changeSessionCookie(), changeSessionCookie()]
      await jest.advanceTimersByTimeAsync(2000)
      expect(loads()).toBe(loadsBefore + 1)

      releaseFirst({ user: { id: 'user-b' }, session: { getToken } })
      await Promise.all([first, ...later])

      expect(loads()).toBe(loadsBefore + 2)
      expect(chrome.storage.session.set).not.toHaveBeenCalledWith({
        'enx-account-session-owner': 'user-b',
      })
      expect(chrome.storage.session.set).toHaveBeenLastCalledWith({
        'enx-account-session-owner': 'user-c',
      })
    })

    it('keeps a waiting API request alive when changes during a load resolve to the same account', async () => {
      await makeApiRequest('/api/me')
      const client = { user: { id: 'user-a' }, session: { getToken } }
      const releaseFirst = holdNextLoad()
      ;(createClerkClient as jest.Mock).mockResolvedValue(client)
      const loadsBefore = loads()
      const first = changeSessionCookie()
      await jest.advanceTimersByTimeAsync(1000)
      const request = makeApiRequest('/api/me')
      const later = [changeSessionCookie(), changeSessionCookie()]

      releaseFirst(client)
      await Promise.all([first, ...later])

      expect(await request).toEqual({ success: true, data: {} })
      expect(loads()).toBe(loadsBefore + 2)
      expect(chrome.tabs.sendMessage).not.toHaveBeenCalled()
    })

    it.each([
      ['discards', 'user-b', { success: false }],
      ['applies', 'user-a', { success: true, data: [['fox', 1]] }],
    ])(
      '%s an in-flight response released mid-debounce once the sync settles on %s',
      async (_, nextUser, expected) => {
        await makeApiRequest('/api/me')
        const held = holdNextFetch()
        const previous = makeApiRequest('/api/me/review-words')
        await held.fetching
        clerkUserId = nextUser
        const check = changeSessionCookie()
        held.finish(jsonResponse(200, [['fox', 1]]))
        let settled = false
        void previous.then(() => {
          settled = true
        })

        await jest.advanceTimersByTimeAsync(999)
        expect(settled).toBe(false)
        await jest.advanceTimersByTimeAsync(1)
        await check

        const result = await previous
        expect(result).toMatchObject(expected)
        expect(result.sessionExpired).toBeUndefined()
      }
    )

    it.each([200, 401])(
      'discards a late %s from the previous account without expiring the new account',
      async status => {
        await makeApiRequest('/api/me')
        ;(global.fetch as jest.Mock).mockClear()
        const held = holdNextFetch()
        const previous = makeApiRequest('/api/me/review-words')
        await held.fetching
        clerkUserId = 'user-b'
        const check = changeSessionCookie()
        await jest.advanceTimersByTimeAsync(1000)
        await check
        ;(chrome.tabs.sendMessage as jest.Mock).mockClear()
        held.finish(jsonResponse(status, [['fox', 1]]))
        const result = await previous
        // #236: a switch to another signed-in account is an ordinary failure,
        // never the signed-out state.
        expect(result).toMatchObject({ success: false })
        expect(result.sessionExpired).toBeUndefined()
        expect(chrome.tabs.sendMessage).not.toHaveBeenCalled()
        expect(global.fetch).toHaveBeenCalledTimes(1)
      }
    )

    it('lets a sign-in after a session loss turn an old request into an ordinary failure', async () => {
      await makeApiRequest('/api/me')
      const held = holdNextFetch()
      const previous = makeApiRequest('/api/me/review-words')
      await held.fetching

      setClerkSession(null)
      let check = changeSessionCookie()
      await jest.advanceTimersByTimeAsync(1000)
      await check
      clerkUserId = 'user-b'
      setClerkSession('clerk-session-jwt')
      check = changeSessionCookie()
      await jest.advanceTimersByTimeAsync(1000)
      await check
      held.finish(jsonResponse(200, []))

      const result = await previous
      expect(result).toMatchObject({ success: false })
      expect(result.sessionExpired).toBeUndefined()
      expect(
        (chrome.tabs.sendMessage as jest.Mock).mock.calls.map(c => c[1])
      ).toEqual([
        { action: 'sessionExpired', cause: 'signed-out' },
        { action: 'accountChanged' },
      ])
    })
  })

  it('recovers when a 401 is fixed by a force-refreshed token', async () => {
    ;(global.fetch as jest.Mock)
      .mockResolvedValueOnce(jsonResponse(401, { error: 'token expired' }))
      .mockResolvedValueOnce(jsonResponse(200, { English: 'ok' }))

    const result = await makeApiRequest('/api/translate?word=test')

    expect(result).toEqual({ success: true, data: { English: 'ok' } })
    expect(global.fetch).toHaveBeenCalledTimes(2)
    expect(getToken).toHaveBeenNthCalledWith(2, { skipCache: true })
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled()
  })

  it('propagates a non-401 error status (e.g. 402 insufficient credit)', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse(402, {
        message: 'Insufficient credit. Please add credit or subscribe.',
      })
    )

    const result = await makeApiRequest('/api/translate/sentence', {
      method: 'POST',
    })

    expect(result).toEqual({
      success: false,
      error: 'Insufficient credit. Please add credit or subscribe.',
      status: 402,
    })
  })

  // ADR-060 Decision 4: callers tell the 429s apart by code, and wait
  // Retry-After before trying again.
  it("passes a 429's code and Retry-After through", async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse(
        429,
        {
          success: false,
          code: 'too_many_requests',
          message:
            'Too many requests. Please slow down and try again in a moment.',
        },
        false,
        { 'Retry-After': '2' }
      )
    )

    const result = await makeApiRequest('/api/translate?word=cat')

    expect(result).toEqual({
      success: false,
      error: 'Too many requests. Please slow down and try again in a moment.',
      status: 429,
      code: 'too_many_requests',
      retryAfterMs: 2000,
    })
  })

  describe('gateway 503 replay', () => {
    const kong503 = () =>
      jsonResponse(
        503,
        { message: 'failure to get a peer from the ring-balancer' },
        false
      )

    beforeEach(() => jest.useFakeTimers())
    afterEach(() => jest.useRealTimers())

    it('replays a request the gateway refused until enx-api is back', async () => {
      ;(global.fetch as jest.Mock)
        .mockResolvedValueOnce(kong503())
        .mockResolvedValueOnce(kong503())
        .mockResolvedValueOnce(jsonResponse(200, { chinese: '缺点' }))

      const pending = makeApiRequest('/api/translate/sentence', {
        method: 'POST',
      })
      await jest.runAllTimersAsync()

      expect(await pending).toEqual({
        success: true,
        data: { chinese: '缺点' },
      })
      expect(global.fetch).toHaveBeenCalledTimes(3)
    })

    it('gives up after its retries with the readable message', async () => {
      ;(global.fetch as jest.Mock).mockResolvedValue(kong503())

      const pending = makeApiRequest('/api/translate/sentence', {
        method: 'POST',
      })
      await jest.runAllTimersAsync()

      expect(await pending).toEqual({
        success: false,
        error: 'Service temporarily unavailable. Please retry.',
        status: 503,
      })
      expect(global.fetch).toHaveBeenCalledTimes(3)
    })

    it.each([
      [
        'a 503 enx-api wrote itself',
        jsonResponse(
          503,
          { success: false, message: 'Dictionary unavailable' },
          false
        ),
      ],
      [
        'a gateway 502 (enx-api may have handled it)',
        jsonResponse(
          502,
          { message: 'An invalid response from upstream' },
          false
        ),
      ],
      [
        'a gateway 504 (enx-api may have handled it)',
        jsonResponse(
          504,
          { message: 'The upstream server is timing out' },
          false
        ),
      ],
    ])('does not replay %s', async (_name, response) => {
      ;(global.fetch as jest.Mock).mockResolvedValue(response)

      const pending = makeApiRequest('/api/translate/sentence', {
        method: 'POST',
      })
      await jest.runAllTimersAsync()
      await pending

      expect(global.fetch).toHaveBeenCalledTimes(1)
    })
  })

  // #133: an idempotent call opts in to retry, so a reply lost after enx-api
  // wrote (or an enx-api 5xx) doesn't drop the user's action.
  describe('retry option for idempotent calls', () => {
    beforeEach(() => {
      jest.useFakeTimers()
      // resetAllMocks() wipes the env mock's implementation too.
    })
    afterEach(() => jest.useRealTimers())

    const run = async (retry?: boolean) => {
      const pending = makeApiRequest(
        '/api/me/words/cat/known',
        { method: 'PUT' },
        retry === undefined ? undefined : { retry }
      )
      await jest.runAllTimersAsync()
      return pending
    }

    it('retries a network failure', async () => {
      ;(global.fetch as jest.Mock)
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce(jsonResponse(200, { Known: true }))

      expect(await run(true)).toEqual({
        success: true,
        data: { Known: true },
      })
      expect(global.fetch).toHaveBeenCalledTimes(2)
    })

    it.each([
      [
        'a 500 enx-api wrote',
        jsonResponse(500, { success: false, message: 'db locked' }, false),
      ],
      [
        'a gateway 504 (the write may have landed; replaying is safe)',
        jsonResponse(504, { message: 'upstream timed out' }, false),
      ],
    ])('retries %s', async (_name, failure) => {
      ;(global.fetch as jest.Mock)
        .mockResolvedValueOnce(failure)
        .mockResolvedValueOnce(jsonResponse(200, { Known: true }))

      expect(await run(true)).toEqual({
        success: true,
        data: { Known: true },
      })
      expect(global.fetch).toHaveBeenCalledTimes(2)
    })

    it.each([
      [
        'an enx-api 500',
        () =>
          Promise.resolve(
            jsonResponse(500, { success: false, message: 'db locked' }, false)
          ),
        { success: false, error: 'db locked', status: 500 },
      ],
      [
        'a gateway 503',
        () => Promise.resolve(jsonResponse(503, { message: 'no peer' }, false)),
        { success: false, error: SERVICE_UNAVAILABLE_MESSAGE, status: 503 },
      ],
      [
        'a network failure',
        () => Promise.reject(new TypeError('Failed to fetch')),
        { success: false, error: NETWORK_ERROR_MESSAGE },
      ],
    ])('gives up on %s after two retries', async (_name, reply, want) => {
      ;(global.fetch as jest.Mock).mockImplementation(reply)

      expect(await run(true)).toEqual(want)
      expect(global.fetch).toHaveBeenCalledTimes(3)
    })

    it('does not retry a 4xx answer', async () => {
      ;(global.fetch as jest.Mock).mockResolvedValue(
        jsonResponse(404, { success: false, message: 'not found' }, false)
      )

      expect(await run(true)).toMatchObject({ success: false, status: 404 })
      expect(global.fetch).toHaveBeenCalledTimes(1)
    })

    it.each([
      [
        'an enx-api 500',
        () =>
          Promise.resolve(
            jsonResponse(500, { success: false, message: 'db locked' }, false)
          ),
      ],
      [
        'a network failure',
        () => Promise.reject(new TypeError('Failed to fetch')),
      ],
    ])('does not retry %s without the option', async (_name, reply) => {
      ;(global.fetch as jest.Mock).mockImplementation(reply)

      expect((await run()).success).toBe(false)
      expect(global.fetch).toHaveBeenCalledTimes(1)
    })
  })

  it('retries getToken() when the session is present but the first mint blips', async () => {
    // The dev-instance JWT mint (Frontend API round-trip) can fail transiently
    // even with an active session -- retry rather than fall through to a 401.
    setClerkSession('eventual-jwt')
    getToken.mockReset()
    getToken
      .mockRejectedValueOnce(new Error('network blip'))
      .mockResolvedValueOnce('eventual-jwt')
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse(200, { English: 'test' })
    )

    const result = await makeApiRequest('/api/translate?word=test')

    expect(result).toEqual({ success: true, data: { English: 'test' } })
    const [, requestInit] = (global.fetch as jest.Mock).mock.calls[0]
    expect(requestInit.headers.Authorization).toBe('Bearer eventual-jwt')
    expect(getToken).toHaveBeenCalledTimes(2)
  })

  it('retries once with a fresh Clerk client when the cached session comes back empty', async () => {
    // Simulates a service worker cold-start racing the dev-instance JWT
    // relay (ADR-015): the cached client's session reads empty, but a fresh
    // client -- the mitigation's retry -- picks up the now-synced session.
    setClerkSession(null)
    const callsBefore = (createClerkClient as jest.Mock).mock.calls.length
    ;(createClerkClient as jest.Mock).mockImplementationOnce(async () => ({
      session: { getToken: jest.fn(async () => 'recovered-jwt') },
    }))
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse(200, { English: 'test' })
    )

    const result = await makeApiRequest('/api/translate?word=test')

    expect(result).toEqual({ success: true, data: { English: 'test' } })
    const [, requestInit] = (global.fetch as jest.Mock).mock.calls[0]
    expect(requestInit.headers.Authorization).toBe('Bearer recovered-jwt')
    expect((createClerkClient as jest.Mock).mock.calls.length).toBe(
      callsBefore + 1
    )
  })

  it('collapses parallel lookups after a cold start onto one session re-sync (#15)', async () => {
    // A page load fires several lookups at once into a just-woken worker
    // whose first Clerk client has no session yet. They must share one
    // rebuild instead of each nulling and rebuilding the client.
    __resetClerkClientCacheForTests()
    let created = 0
    ;(createClerkClient as jest.Mock).mockImplementation(async () => {
      created++
      return {
        session:
          created === 1
            ? null
            : { getToken: jest.fn(async () => 'recovered-jwt') },
      }
    })
    ;(global.fetch as jest.Mock).mockImplementation(async () =>
      jsonResponse(200, { English: 'test' })
    )

    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        makeApiRequest(`/api/translate?word=w${i}`)
      )
    )

    expect(results.every(r => r.success)).toBe(true)
    for (const [, requestInit] of (global.fetch as jest.Mock).mock.calls) {
      expect(requestInit.headers.Authorization).toBe('Bearer recovered-jwt')
    }
    expect(created).toBe(2)
  })

  it('starts a fresh re-sync for a call made after a failed one settled', async () => {
    // The shared re-sync must not pin "signed out" forever: once it settles,
    // the next call gets its own attempt (e.g. the user signed in meanwhile).
    __resetClerkClientCacheForTests()
    let signedIn = false
    const laterSession = { getToken: jest.fn(async () => 'later-jwt') }
    // No user id either way, so the sign-in is not an account switch.
    ;(createClerkClient as jest.Mock).mockImplementation(async () => {
      const session = signedIn ? laterSession : null
      return { ...fakeClerkClient(() => session), user: null }
    })
    ;(global.fetch as jest.Mock).mockImplementation(async () =>
      jsonResponse(200, {})
    )
    expect(await makeApiRequest('/api/me')).toMatchObject({
      sessionExpired: true,
    })

    signedIn = true
    await makeApiRequest('/api/me')

    expect(global.fetch).toHaveBeenCalledTimes(1)
    const [, requestInit] = (global.fetch as jest.Mock).mock.calls[0]
    expect(requestInit.headers.Authorization).toBe('Bearer later-jwt')
  })

  it('reports a real session expiry when the retried client is also empty', async () => {
    setClerkSession(null)
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(jsonResponse(200, {}))

    const result = await makeApiRequest('/api/me')

    expect(result).toMatchObject({ success: false, sessionExpired: true })
    expect(global.fetch).not.toHaveBeenCalled()
  })
})

// #133: Mark Known always means "set to known", so it sends the idempotent
// PUT and may retry it.
describe('background onMessage / markKnown', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    jest.useFakeTimers()
    setClerkSession('clerk-session-jwt')
    ;(global.fetch as jest.Mock) = jest.fn()
  })
  afterEach(() => jest.useRealTimers())

  const markKnown = async (word: string) => {
    const pending = new Promise(resolve => {
      onMessageListener({ type: 'markKnown', word }, {}, resolve)
    })
    await jest.runAllTimersAsync()
    return pending
  }

  it('sends PUT /api/me/words/:english/known with the word path-encoded', async () => {
    const state = { English: "don't", LoadCount: 2, Known: true }
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(jsonResponse(200, state))

    expect(await markKnown(" don't ")).toEqual({ success: true, ecp: state })
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toBe("http://localhost:8090/api/me/words/don't/known")
    expect(init.method).toBe('PUT')
  })

  it('retries when the reply is lost', async () => {
    const state = { English: 'cat', LoadCount: 0, Known: true }
    ;(global.fetch as jest.Mock)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse(200, state))

    expect(await markKnown('cat')).toEqual({ success: true, ecp: state })
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })
})

// ADR-059 Decision 3: the lookup GET only reads, so it may retry; the POST
// that adds to the query count is not idempotent and never retries.
describe('background onMessage / lookups and the query count', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    jest.useFakeTimers()
    setClerkSession('clerk-session-jwt')
    ;(global.fetch as jest.Mock) = jest.fn()
  })
  afterEach(() => jest.useRealTimers())

  const send = async (message: object) => {
    const pending = new Promise(resolve => {
      onMessageListener(message, {}, resolve)
    })
    await jest.runAllTimersAsync()
    return pending
  }

  it('retries a lookup whose reply was lost', async () => {
    const ecp = { Id: 'w1', English: 'cat', Chinese: 'n. 猫', LoadCount: 2 }
    ;(global.fetch as jest.Mock)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse(200, ecp))

    expect(await send({ type: 'getOneWord', word: 'cat' })).toEqual({
      success: true,
      ecp,
    })
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it("passes a lookup 429's code through to the caller", async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse(
        429,
        { code: 'too_many_requests', message: 'Too many requests.' },
        false,
        { 'Retry-After': '1' }
      )
    )

    expect(await send({ type: 'getOneWord', word: 'cat' })).toEqual({
      success: false,
      error: 'Too many requests.',
      status: 429,
      code: 'too_many_requests',
    })
  })

  it('records a lookup with POST /api/me/word-lookups and the word id', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse(200, { queryCount: 3, known: false })
    )

    await send({ type: 'recordWordLookup', wordId: 'w1' })

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toBe('http://localhost:8090/api/me/word-lookups')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ wordId: 'w1' })
  })

  it.each([
    [
      'a network failure',
      () => Promise.reject(new TypeError('Failed to fetch')),
    ],
    ['a 500', () => Promise.resolve(jsonResponse(500, {}))],
    // ADR-060 Decision 4: not even after waiting Retry-After.
    [
      'a rate-limit 429',
      () =>
        Promise.resolve(
          jsonResponse(429, { code: 'too_many_requests' }, false, {
            'Retry-After': '1',
          })
        ),
    ],
  ])('does not retry recording a lookup after %s', async (_name, reply) => {
    ;(global.fetch as jest.Mock).mockImplementation(reply)

    await send({ type: 'recordWordLookup', wordId: 'w1' })

    expect(global.fetch).toHaveBeenCalledTimes(1)
  })
})

describe('background onMessage / validateSession', () => {
  const listener = onMessageListener

  beforeEach(() => {
    jest.resetAllMocks()
    setClerkSession('clerk-session-jwt')
    ;(chrome.storage.local.remove as jest.Mock).mockResolvedValue(undefined)
    ;(chrome.tabs.query as jest.Mock).mockResolvedValue([{ id: 1 }])
    ;(chrome.tabs.sendMessage as jest.Mock).mockResolvedValue(undefined)
    ;(global.fetch as jest.Mock) = jest.fn()
  })

  it('routes a popup session check through makeApiRequest and returns /api/me', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse(200, {
        id: '1',
        name: 'Test User',
        email: 'test@example.com',
        status: 'active',
      })
    )

    const response = await new Promise(resolve => {
      const keepChannelOpen = listener({ type: 'validateSession' }, {}, resolve)
      expect(keepChannelOpen).toBe(true)
    })

    expect(response).toEqual({
      success: true,
      data: {
        id: '1',
        name: 'Test User',
        email: 'test@example.com',
        status: 'active',
      },
    })
  })

  it('reports session-expired on a 401', async () => {
    // Persistent 401 so both the initial and the force-refresh retry see it.
    expireOnForcedMint()
    ;(global.fetch as jest.Mock).mockResolvedValue(jsonResponse(401, {}))

    const response = await new Promise(resolve => {
      listener({ type: 'validateSession' }, {}, resolve)
    })

    expect(response).toEqual({
      success: false,
      error: 'Your session has expired. Please login again.',
      sessionExpired: true,
    })
  })
})

// ADR-044: server-side preferences. The options page can't hold the session
// token, so it asks the background to call /api/me/preferences.
describe('background onMessage / getPreferences and updatePreferences (ADR-044)', () => {
  const listener = onMessageListener
  const call = (request: unknown) =>
    new Promise(resolve => {
      expect(listener(request, {}, resolve)).toBe(true)
    })

  beforeEach(() => {
    jest.resetAllMocks()
    __resetClerkClientCacheForTests()
    setClerkSession('clerk-session-jwt')
    ;(chrome.storage.local.remove as jest.Mock).mockResolvedValue(undefined)
    ;(chrome.tabs.query as jest.Mock).mockResolvedValue([{ id: 1 }])
    ;(chrome.tabs.sendMessage as jest.Mock).mockResolvedValue(undefined)
    ;(global.fetch as jest.Mock) = jest.fn()
  })

  it('getPreferences reads GET /api/me/preferences with the session token', async () => {
    const prefs = {
      aiWordFallback: { value: null, effective: true, editable: true },
    }
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(jsonResponse(200, prefs))

    const response = await call({ type: 'getPreferences' })

    expect(response).toEqual({ success: true, data: prefs })
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toBe('http://localhost:8090/api/me/preferences')
    expect(init.method).toBeUndefined()
    expect(init.headers.Authorization).toBe('Bearer clerk-session-jwt')
  })

  it('updatePreferences sends the partial change as a PUT body', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(jsonResponse(200, {}))

    await call({
      type: 'updatePreferences',
      changes: { aiWordFallback: false, aiWordFallbackNoticeAck: null },
    })

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toBe('http://localhost:8090/api/me/preferences')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body)).toEqual({
      aiWordFallback: false,
      aiWordFallbackNoticeAck: null,
    })
  })

  it.each([
    ['missing', undefined],
    ['null', null],
    ['an array', [true]],
    ['a string', 'aiWordFallback'],
  ])(
    'updatePreferences refuses %s changes without calling the API',
    async (_name, changes) => {
      const response = await call({ type: 'updatePreferences', changes })

      expect(response).toMatchObject({ success: false })
      expect(global.fetch).not.toHaveBeenCalled()
    }
  )

  it('passes a 403 through with the server message and status', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse(403, { message: 'Not entitled' }, false)
    )

    const response = await call({
      type: 'updatePreferences',
      changes: { aiWordFallback: true },
    })

    expect(response).toEqual({
      success: false,
      error: 'Not entitled',
      status: 403,
    })
  })

  it('reports session expiry on a 401', async () => {
    expireOnForcedMint()
    ;(global.fetch as jest.Mock).mockResolvedValue(jsonResponse(401, {}))

    const response = await call({ type: 'getPreferences' })

    expect(response).toMatchObject({ success: false, sessionExpired: true })
  })
})

// ADR-045: the AI word fallback's second request.
describe('background onMessage / defineWordWithAI (ADR-045)', () => {
  const listener = onMessageListener
  const call = (request: unknown) =>
    new Promise(resolve => {
      expect(listener(request, {}, resolve)).toBe(true)
    })

  beforeEach(() => {
    jest.resetAllMocks()
    __resetClerkClientCacheForTests()
    setClerkSession('clerk-session-jwt')
    ;(chrome.storage.local.remove as jest.Mock).mockResolvedValue(undefined)
    ;(chrome.tabs.query as jest.Mock).mockResolvedValue([{ id: 1 }])
    ;(chrome.tabs.sendMessage as jest.Mock).mockResolvedValue(undefined)
    ;(global.fetch as jest.Mock) = jest.fn()
  })

  it('POSTs only the word to /api/dictionary/ai-word', async () => {
    const body = { found: true, word: { English: 'rizzler' } }
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(jsonResponse(200, body))

    const response = await call({
      type: 'defineWordWithAI',
      word: '  rizzler  ',
      // Anything else a caller adds must never be forwarded.
      sentence: 'He is a total rizzler.',
    })

    expect(response).toEqual({ success: true, data: body })
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toBe('http://localhost:8090/api/dictionary/ai-word')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ word: 'rizzler' })
    expect(init.headers.Authorization).toBe('Bearer clerk-session-jwt')
  })

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['blank', '   '],
    ['a number', 42],
    ['an object', { word: 'rizzler' }],
  ])('refuses %s word without calling the API', async (_name, word) => {
    const response = await call({ type: 'defineWordWithAI', word })

    expect(response).toMatchObject({ success: false })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it.each([
    [402, 'Insufficient credit'],
    [403, 'Not entitled'],
    [429, 'Too many AI lookups'],
    [502, 'AI lookup failed'],
  ])('passes a %i through with its status', async (status, message) => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse(status, { success: false, message }, false)
    )

    const response = await call({ type: 'defineWordWithAI', word: 'rizzler' })

    expect(response).toEqual({ success: false, error: message, status })
  })

  it.each([
    [
      'Kong with no healthy upstream',
      503,
      { message: 'failure to get a peer from the ring-balancer' },
    ],
    ['an HTML gateway page', 502, '<html>Bad Gateway</html>'],
    [
      'a gateway timeout',
      504,
      { message: 'The upstream server is timing out' },
    ],
  ])(
    'replaces the raw text of %s with a readable message',
    async (_name, status, body) => {
      const response = jsonResponse(status, body, false)
      if (typeof body === 'string') {
        response.json = async () => {
          throw new SyntaxError('Unexpected token <')
        }
      }
      ;(global.fetch as jest.Mock).mockResolvedValue(response)
      jest.useFakeTimers()
      try {
        const pending = call({ type: 'defineWordWithAI', word: 'rizzler' })
        await jest.runAllTimersAsync()

        expect(await pending).toEqual({
          success: false,
          error: 'Service temporarily unavailable. Please retry.',
          status,
        })
      } finally {
        jest.useRealTimers()
      }
    }
  )

  it('reports session expiry on a 401', async () => {
    expireOnForcedMint()
    ;(global.fetch as jest.Mock).mockResolvedValue(jsonResponse(401, {}))

    const response = await call({ type: 'defineWordWithAI', word: 'rizzler' })

    expect(response).toMatchObject({ success: false, sessionExpired: true })
  })
})

// ADR-020: the popup delegates opening the web sign-in tab to the background
// (the popup is destroyed the moment chrome.tabs.create steals focus).
describe('background onMessage / openWebSignIn (ADR-020)', () => {
  const listener = onMessageListener

  beforeEach(() => {
    jest.resetAllMocks()
    ;(chrome.tabs.query as jest.Mock).mockResolvedValue([
      { id: 42, windowId: 7 },
    ])
    ;(chrome.tabs.create as jest.Mock).mockResolvedValue({ id: 99 })
    ;(chrome.storage.session.set as jest.Mock).mockResolvedValue(undefined)
  })

  const send = (request: unknown): Promise<unknown> =>
    new Promise(resolve => listener(request, {}, resolve))

  it('opens the sign-in tab with the extension marker and the return redirect', async () => {
    const response = await send({ action: 'openWebSignIn' })

    expect(response).toEqual({ success: true })
    const [{ url }] = (chrome.tabs.create as jest.Mock).mock.calls[0]
    expect(url).toContain('http://localhost:3000/sign-in')
    expect(url).toContain('src=extension')
    expect(url).toContain(
      `redirect_url=${encodeURIComponent('/extension/connected')}`
    )
  })

  it('records the tab the user came from for the return trip', async () => {
    await send({ action: 'openWebSignIn' })

    expect(chrome.storage.session.set).toHaveBeenCalledWith(
      expect.objectContaining({
        'enx-signin-return': expect.objectContaining({
          originTabId: 42,
          originWindowId: 7,
          loginTabId: 99,
        }),
      })
    )
  })

  it('still opens the sign-in tab when there is no identifiable origin tab', async () => {
    ;(chrome.tabs.query as jest.Mock).mockResolvedValue([])

    const response = await send({ action: 'openWebSignIn' })

    expect(response).toEqual({ success: true })
    expect(chrome.tabs.create).toHaveBeenCalled()
    expect(chrome.storage.session.set).not.toHaveBeenCalled()
  })
})

// ADR-008: the phrase-in-context lookup reuses the 'openSentencePanel'
// message/handler, just with an extra `phrase` field threaded through to
// PendingSentenceContext. ADR-050: the context is stored under the sending
// tab's own key, and the panel opened is that tab's own panel.
describe('background onMessage / openSentencePanel phrase passthrough (ADR-008)', () => {
  const listener = onMessageListener

  beforeEach(() => {
    jest.resetAllMocks()
    setClerkSession('clerk-session-jwt')
    ;(chrome.storage.session.set as jest.Mock).mockResolvedValue(undefined)
    ;(chrome.sidePanel.setOptions as jest.Mock).mockResolvedValue(undefined)
    ;(chrome.sidePanel.open as jest.Mock).mockResolvedValue(undefined)
  })

  it('threads request.phrase into the stored PendingSentenceContext', async () => {
    const response = await new Promise(resolve => {
      listener(
        {
          type: 'openSentencePanel',
          word: '',
          phrase: 'hunt down emails',
          sentence: 'I had to hunt down emails and draft outreach.',
        },
        { tab: { id: 7 } },
        resolve
      )
    })

    expect(response).toEqual({ success: true, panelOpened: true })
    expect(chrome.storage.session.set).toHaveBeenCalledWith(
      expect.objectContaining({
        'enx-pending-sentence:7': expect.objectContaining({
          word: '',
          phrase: 'hunt down emails',
          sentence: 'I had to hunt down emails and draft outreach.',
        }),
      })
    )
  })

  it('fires sidePanel.open() synchronously from the listener, before the storage write', async () => {
    const calls: string[] = []
    ;(chrome.sidePanel.open as jest.Mock).mockImplementation(async () => {
      calls.push('sidePanel.open')
    })
    ;(chrome.storage.session.set as jest.Mock).mockImplementation(async () => {
      calls.push('storage.session.set')
    })

    const response = await new Promise(resolve => {
      listener(
        {
          type: 'openSentencePanel',
          word: 'great',
          sentence: 'Cats are great pets.',
        },
        { tab: { id: 7 } },
        resolve
      )
    })

    expect(response).toEqual({ success: true, panelOpened: true })
    expect(chrome.sidePanel.setOptions).toHaveBeenCalledWith({
      tabId: 7,
      path: 'sidepanel.html?tabId=7',
      enabled: true,
    })
    expect(chrome.sidePanel.open).toHaveBeenCalledWith({ tabId: 7 })
    expect(calls).toEqual(['sidePanel.open', 'storage.session.set'])
  })

  it('falls back to a getContexts() probe when the gesture did not forward', async () => {
    ;(chrome.sidePanel.open as jest.Mock).mockRejectedValue(
      new Error(
        'sidePanel.open() may only be called in response to a user gesture'
      )
    )
    ;(chrome.runtime.getContexts as jest.Mock).mockResolvedValue([
      { contextType: 'BACKGROUND' },
      {
        contextType: 'SIDE_PANEL',
        documentUrl: 'chrome-extension://test/sidepanel.html?tabId=7',
      },
    ])

    const response = await new Promise(resolve => {
      listener(
        {
          type: 'openSentencePanel',
          word: 'great',
          sentence: 'Cats are great pets.',
        },
        { tab: { id: 7, windowId: 3 } },
        resolve
      )
    })

    expect(response).toEqual({ success: true, panelOpened: true })
    expect(chrome.storage.session.set).toHaveBeenCalled()
  })

  it('reports panelOpened:false when the gesture did not forward and no panel is open', async () => {
    ;(chrome.sidePanel.open as jest.Mock).mockRejectedValue(
      new Error(
        'sidePanel.open() may only be called in response to a user gesture'
      )
    )
    ;(chrome.runtime.getContexts as jest.Mock).mockResolvedValue([
      { contextType: 'BACKGROUND' },
    ])

    const response = await new Promise(resolve => {
      listener(
        {
          type: 'openSentencePanel',
          word: 'great',
          sentence: 'Cats are great pets.',
        },
        { tab: { id: 7 } },
        resolve
      )
    })

    expect(response).toEqual({ success: true, panelOpened: false })
  })

  it("reports panelOpened:false when only another tab's panel is open", async () => {
    ;(chrome.sidePanel.open as jest.Mock).mockRejectedValue(
      new Error(
        'sidePanel.open() may only be called in response to a user gesture'
      )
    )
    ;(chrome.runtime.getContexts as jest.Mock).mockResolvedValue([
      {
        contextType: 'SIDE_PANEL',
        documentUrl: 'chrome-extension://test/sidepanel.html?tabId=8',
      },
    ])

    const response = await new Promise(resolve => {
      listener(
        {
          type: 'openSentencePanel',
          word: 'great',
          sentence: 'Cats are great pets.',
        },
        { tab: { id: 7 } },
        resolve
      )
    })

    expect(response).toEqual({ success: true, panelOpened: false })
  })

  it('leaves phrase undefined for the existing whole-sentence/single-word callers', async () => {
    const response = await new Promise(resolve => {
      listener(
        {
          type: 'openSentencePanel',
          word: 'great',
          sentence: 'Cats are great pets.',
        },
        { tab: { id: 7 } },
        resolve
      )
    })

    expect(response).toEqual({ success: true, panelOpened: true })
    expect(chrome.storage.session.set).toHaveBeenCalledWith(
      expect.objectContaining({
        'enx-pending-sentence:7': expect.objectContaining({
          word: 'great',
          phrase: undefined,
        }),
      })
    )
  })
})

describe('background onMessage / translateSentenceWithWord (ADR-014)', () => {
  const listener = onMessageListener

  beforeEach(() => {
    jest.resetAllMocks()
    setClerkSession('clerk-session-jwt')
    ;(chrome.storage.local.remove as jest.Mock).mockResolvedValue(undefined)
    ;(global.fetch as jest.Mock) = jest.fn()
  })

  const send = (request: unknown): Promise<unknown> =>
    new Promise(resolve => listener(request, {}, resolve))

  it('POSTs sentence + word to /api/translate/sentence-with-word and returns both halves', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse(200, {
        success: true,
        chinese: '猫是很棒的宠物。',
        wordChinese: '极好的',
      })
    )

    const response = await send({
      type: 'translateSentenceWithWord',
      sentence: 'Cats are great pets.',
      word: 'great',
    })

    expect(response).toEqual({
      success: true,
      chinese: '猫是很棒的宠物。',
      wordChinese: '极好的',
    })
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toContain('/api/translate/sentence-with-word')
    expect(JSON.parse(init.body)).toEqual({
      sentence: 'Cats are great pets.',
      word: 'great',
    })
  })

  it('normalizes a missing wordChinese to an empty string (graceful degrade)', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse(200, { success: true, chinese: '猫是很棒的宠物。' })
    )

    const response = await send({
      type: 'translateSentenceWithWord',
      sentence: 'Cats are great pets.',
      word: 'great',
    })

    expect(response).toEqual({
      success: true,
      chinese: '猫是很棒的宠物。',
      wordChinese: '',
    })
  })

  it('propagates the HTTP status on failure (e.g. 402 insufficient credit)', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse(402, {
        success: false,
        message: 'Insufficient credit. Please add credit or subscribe.',
      })
    )

    const response = (await send({
      type: 'translateSentenceWithWord',
      sentence: 'Cats are great pets.',
      word: 'great',
    })) as { success: boolean; status?: number }

    expect(response.success).toBe(false)
    expect(response.status).toBe(402)
  })

  it('rejects a request missing the word without calling the API', async () => {
    const response = await send({
      type: 'translateSentenceWithWord',
      sentence: 'Cats are great pets.',
      word: '',
    })

    expect(response).toEqual({
      success: false,
      error: 'sentence and word are required',
    })
    expect(global.fetch).not.toHaveBeenCalled()
  })
})

describe('background onMessage / submitPageReport (ADR-010 Decision 8)', () => {
  const listener = onMessageListener

  beforeEach(() => {
    jest.resetAllMocks()
    setClerkSession('clerk-session-jwt')
    ;(chrome.runtime.getManifest as jest.Mock).mockReturnValue({
      version: '1.0.1',
    })
    ;(global.fetch as jest.Mock) = jest.fn()
  })

  const send = (request: unknown): Promise<unknown> =>
    new Promise(resolve => listener(request, {}, resolve))

  it('POSTs the page report to /api/page-reports with the extension version', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse(200, { success: true, recorded: true })
    )

    const response = await send({
      type: 'submitPageReport',
      pageReport: {
        url: 'https://x.com/a/status/1',
        reason: 'no-article-node',
        adapter: 'x',
      },
    })

    expect(response).toMatchObject({ success: true })
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toContain('/api/page-reports')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({
      url: 'https://x.com/a/status/1',
      reason: 'no-article-node',
      adapter: 'x',
      extVersion: '1.0.1',
    })
  })

  it('reports failure to the popup instead of dropping a report the user confirmed', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse(500, {
        success: false,
        message: 'could not record the report',
      })
    )

    const response = (await send({
      type: 'submitPageReport',
      pageReport: {
        url: 'https://x.com/a/status/1',
        reason: 'error',
        adapter: 'x',
      },
    })) as { success: boolean }

    expect(response.success).toBe(false)
  })

  it('rejects a request with no URL without calling the API', async () => {
    const response = await send({ type: 'submitPageReport' })

    expect(response).toEqual({ success: false, error: 'Missing report' })
    expect(global.fetch).not.toHaveBeenCalled()
  })
})

describe('background onMessage / savePage (ADR-032)', () => {
  const listener = onMessageListener

  beforeEach(() => {
    jest.resetAllMocks()
    setClerkSession('clerk-session-jwt')
    ;(global.fetch as jest.Mock) = jest.fn()
  })

  const send = (request: unknown): Promise<unknown> =>
    new Promise(resolve => listener(request, {}, resolve))

  it('POSTs the page URL and title to /api/saved-pages and returns what was stored', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse(201, {
        success: true,
        created: true,
        page: {
          id: 'p1',
          url: 'https://www.infoq.com/articles/kube',
          title: 'Kube',
          host: 'www.infoq.com',
        },
      })
    )

    const response = await send({
      type: 'savePage',
      savedPage: {
        url: 'https://www.infoq.com/articles/kube?utm_source=x#top',
        title: 'Kube',
      },
    })

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toContain('/api/saved-pages')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({
      url: 'https://www.infoq.com/articles/kube?utm_source=x#top',
      title: 'Kube',
    })
    expect(response).toMatchObject({
      success: true,
      data: {
        created: true,
        page: { url: 'https://www.infoq.com/articles/kube' },
      },
    })
  })

  it("passes the server's own message and status through when the save is refused", async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse(422, {
        success: false,
        message: 'You can save up to 1000 pages. Delete some to save more.',
      })
    )

    const response = await send({
      type: 'savePage',
      savedPage: { url: 'https://example.com/one-too-many', title: 't' },
    })

    expect(response).toEqual({
      success: false,
      error: 'You can save up to 1000 pages. Delete some to save more.',
      status: 422,
    })
  })

  it('rejects a request with no URL without calling the API', async () => {
    const response = await send({
      type: 'savePage',
      savedPage: { url: '', title: 't' },
    })

    expect(response).toEqual({ success: false, error: 'Missing page' })
    expect(global.fetch).not.toHaveBeenCalled()
  })
})

describe('background onMessage / removeSavedPage (ADR-032 Decision 4a)', () => {
  const listener = onMessageListener

  beforeEach(() => {
    jest.resetAllMocks()
    setClerkSession('clerk-session-jwt')
    ;(global.fetch as jest.Mock) = jest.fn()
  })

  const send = (request: unknown): Promise<unknown> =>
    new Promise(resolve => listener(request, {}, resolve))

  it('DELETEs the saved page by id and sends no page address', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse(200, { success: true })
    )

    const response = await send({ type: 'removeSavedPage', savedPageId: 'p1' })

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toMatch(/\/api\/saved-pages\/p1$/)
    expect(init.method).toBe('DELETE')
    expect(init.body).toBeUndefined()
    expect(response).toMatchObject({ success: true })
  })

  it('passes a 404 through so the popup can tell the page is already gone', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse(404, { success: false, message: 'saved page not found' })
    )

    const response = await send({ type: 'removeSavedPage', savedPageId: 'p1' })

    expect(response).toMatchObject({ success: false, status: 404 })
  })

  it('rejects a request with no id without calling the API', async () => {
    const response = await send({ type: 'removeSavedPage' })

    expect(response).toEqual({ success: false, error: 'Missing saved page' })
    expect(global.fetch).not.toHaveBeenCalled()
  })
})

describe('background onMessageExternal (ADR-019 web -> extension channel)', () => {
  const external = onMessageExternalListener

  beforeEach(() => {
    jest.resetAllMocks()
    __resetClerkClientCacheForTests()
    setClerkSession('clerk-session-jwt')
    ;(chrome.runtime.getManifest as jest.Mock).mockReturnValue({
      version: '1.2.3',
    })
    ;(chrome.tabs.sendMessage as jest.Mock).mockResolvedValue(undefined)
  })

  const call = (
    message: unknown,
    sender: Partial<chrome.runtime.MessageSender> = {
      origin: 'https://enx.wiloon.com',
      tab: { id: 7 } as chrome.tabs.Tab,
    }
  ): Promise<unknown> =>
    new Promise(resolve =>
      external(message, sender as chrome.runtime.MessageSender, resolve)
    )

  it('answers enx:ping with the extension version', async () => {
    const response = await call({ type: 'enx:ping' })
    expect(response).toEqual({ ok: true, version: '1.2.3' })
  })

  // ADR-047 Decision 4: /welcome ticks "Pin the icon" from this.
  it('answers enx:status with the version and whether the icon is pinned', async () => {
    ;(chrome.action.getUserSettings as jest.Mock).mockResolvedValue({
      isOnToolbar: true,
    })
    expect(await call({ type: 'enx:status' })).toEqual({
      ok: true,
      version: '1.2.3',
      isOnToolbar: true,
    })
    ;(chrome.action.getUserSettings as jest.Mock).mockResolvedValue({
      isOnToolbar: false,
    })
    expect(await call({ type: 'enx:status' })).toEqual({
      ok: true,
      version: '1.2.3',
      isOnToolbar: false,
    })
  })

  it('still answers enx:status when Chrome cannot report the toolbar setting', async () => {
    ;(chrome.action.getUserSettings as jest.Mock).mockRejectedValue(
      new Error('unsupported')
    )
    expect(await call({ type: 'enx:status' })).toEqual({
      ok: true,
      version: '1.2.3',
      isOnToolbar: false,
    })
  })

  it('drops enx:status from an origin that is not an enx-ui origin', async () => {
    const sendResponse = jest.fn()
    const keptOpen = external(
      { type: 'enx:status' },
      { origin: 'https://evil.example' } as chrome.runtime.MessageSender,
      sendResponse
    )
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(keptOpen).toBe(false)
    expect(sendResponse).not.toHaveBeenCalled()
    expect(chrome.action.getUserSettings).not.toHaveBeenCalled()
  })

  it('runs enxRun on the sender tab for enx:enable-reader when signed in', async () => {
    const response = await call({ type: 'enx:enable-reader' })
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(7, {
      action: 'enxRun',
    })
    expect(response).toEqual({ ok: true })
  })

  it('refuses enx:enable-reader when signed out, without touching the tab', async () => {
    setClerkSession(null)
    const response = await call({ type: 'enx:enable-reader' })
    expect(response).toEqual({ ok: false, reason: 'signed-out' })
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled()
  })

  it('answers with no-content-script instead of hanging when the tab has no listener', async () => {
    ;(chrome.tabs.sendMessage as jest.Mock).mockRejectedValue(
      new Error('Could not establish connection. Receiving end does not exist.')
    )
    const response = await call({ type: 'enx:enable-reader' })
    expect(response).toEqual({
      ok: false,
      reason: 'no-content-script',
      message: 'Could not establish connection. Receiving end does not exist.',
    })
  })

  it('drops a message from an origin that is not an enx-ui origin', async () => {
    const sendResponse = jest.fn()
    const keptOpen = external(
      { type: 'enx:enable-reader' },
      {
        origin: 'https://evil.example',
        tab: { id: 7 } as chrome.tabs.Tab,
      } as chrome.runtime.MessageSender,
      sendResponse
    )
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(keptOpen).toBe(false)
    expect(sendResponse).not.toHaveBeenCalled()
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled()
  })

  it('answers an unknown message type with ok:false', async () => {
    const response = await call({ type: 'enx:frobnicate' })
    expect(response).toEqual({ ok: false, reason: 'unknown-type' })
  })

  // ADR-020: /extension/connected reports a completed web sign-in.
  describe('enx:signed-in return flow', () => {
    const pending = {
      originTabId: 42,
      originWindowId: 7,
      loginTabId: 99,
      createdAt: Date.now(),
    }

    beforeEach(() => {
      ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({
        'enx-signin-return': pending,
      })
      ;(chrome.storage.session.remove as jest.Mock).mockResolvedValue(undefined)
      ;(chrome.tabs.get as jest.Mock).mockResolvedValue({
        id: 99,
        url: 'http://localhost:3000/extension/connected',
      })
      ;(chrome.tabs.remove as jest.Mock).mockResolvedValue(undefined)
      ;(chrome.tabs.update as jest.Mock).mockResolvedValue(undefined)
      ;(chrome.windows.update as jest.Mock).mockResolvedValue(undefined)
      ;(chrome.runtime.getURL as jest.Mock).mockReturnValue('icon-url')
    })

    it('closes the recorded sign-in tab and refocuses the origin tab', async () => {
      const response = await call({ type: 'enx:signed-in' })

      expect(response).toEqual({ ok: true, returned: true })
      expect(chrome.tabs.remove).toHaveBeenCalledWith(99)
      expect(chrome.tabs.update).toHaveBeenCalledWith(42, { active: true })
      expect(chrome.windows.update).toHaveBeenCalledWith(7, { focused: true })
      expect(chrome.notifications.create).toHaveBeenCalled()
      expect(chrome.storage.session.remove).toHaveBeenCalledWith(
        'enx-signin-return'
      )
    })

    it('refuses when signed out, without touching any tab', async () => {
      setClerkSession(null)

      const response = await call({ type: 'enx:signed-in' })

      expect(response).toEqual({ ok: false, reason: 'signed-out' })
      expect(chrome.tabs.remove).not.toHaveBeenCalled()
      expect(chrome.tabs.update).not.toHaveBeenCalled()
    })

    it('leaves the sign-in tab open if the user navigated it away, but still refocuses', async () => {
      ;(chrome.tabs.get as jest.Mock).mockResolvedValue({
        id: 99,
        url: 'http://localhost:3000/billing',
      })

      const response = await call({ type: 'enx:signed-in' })

      expect(response).toEqual({ ok: true, returned: true })
      expect(chrome.tabs.remove).not.toHaveBeenCalled()
      expect(chrome.tabs.update).toHaveBeenCalledWith(42, { active: true })
    })

    it('is a no-op when there is no pending sign-in', async () => {
      ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({})

      const response = await call({ type: 'enx:signed-in' })

      expect(response).toEqual({ ok: true, returned: false })
      expect(chrome.tabs.remove).not.toHaveBeenCalled()
      expect(chrome.tabs.update).not.toHaveBeenCalled()
    })

    it('ignores a stale pending record', async () => {
      ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({
        'enx-signin-return': {
          ...pending,
          createdAt: Date.now() - 20 * 60_000,
        },
      })

      const response = await call({ type: 'enx:signed-in' })

      expect(response).toEqual({ ok: true, returned: false })
      expect(chrome.tabs.remove).not.toHaveBeenCalled()
      expect(chrome.storage.session.remove).toHaveBeenCalledWith(
        'enx-signin-return'
      )
    })

    // #526: the origin tab is refocused, not reloaded, so the page-load
    // auto-enable check has to be run again from here.
    describe('auto-enable on the origin tab', () => {
      let tabMessages: { tabId: number; action: string }[]
      let originStatus: unknown

      beforeEach(() => {
        tabMessages = []
        originStatus = { status: 'error', reason: 'session-expired' }
        ;(chrome.runtime.getManifest as jest.Mock).mockReturnValue({
          host_permissions: [],
          content_scripts: [{ matches: [], js: [] }],
        })
        ;(chrome.permissions.getAll as jest.Mock).mockResolvedValue({
          permissions: [],
          origins: ['https://www.infoq.com/*'],
        })
        // The worker last saw nobody signed in, so this sign-in is an
        // account change that is broadcast to every tab.
        ;(chrome.storage.session.get as jest.Mock).mockImplementation(
          async (key: string) =>
            key === 'enx-account-session-owner'
              ? { 'enx-account-session-owner': null }
              : { 'enx-signin-return': pending }
        )
        ;(chrome.storage.session.set as jest.Mock).mockResolvedValue(undefined)
        ;(chrome.tabs.query as jest.Mock).mockResolvedValue([{ id: 42 }])
        ;(chrome.tabs.get as jest.Mock).mockImplementation(
          async (id: number) =>
            id === 99
              ? { id: 99, url: 'http://localhost:3000/extension/connected' }
              : { id: 42, url: 'https://www.infoq.com/articles/foo' }
        )
        ;(chrome.tabs.sendMessage as jest.Mock).mockImplementation(
          async (tabId: number, message: { action: string }) => {
            tabMessages.push({ tabId, action: message.action })
            return message.action === 'getLearningModeStatus'
              ? { status: originStatus }
              : { success: true }
          }
        )
      })

      const autoEnables = () =>
        tabMessages.filter(m => m.action === 'autoEnableOnSignInReturn')

      it('asks the origin tab to auto-enable, after the account-change broadcast', async () => {
        await call({ type: 'enx:signed-in' })

        expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
          42,
          { action: 'autoEnableOnSignInReturn' },
          { frameId: 0 }
        )
        const actions = tabMessages.map(m => m.action)
        expect(actions.indexOf('accountChanged')).toBeGreaterThanOrEqual(0)
        expect(actions.indexOf('accountChanged')).toBeLessThan(
          actions.indexOf('autoEnableOnSignInReturn')
        )
      })

      it('leaves an origin tab that is already on alone', async () => {
        originStatus = { status: 'ready' }

        await call({ type: 'enx:signed-in' })

        expect(autoEnables()).toEqual([])
      })

      it('leaves an origin tab on a site that was not granted alone', async () => {
        ;(chrome.permissions.getAll as jest.Mock).mockResolvedValue({
          permissions: [],
          origins: [],
        })

        await call({ type: 'enx:signed-in' })

        expect(autoEnables()).toEqual([])
      })

      it('still answers when the origin tab was closed during sign-in', async () => {
        ;(chrome.tabs.update as jest.Mock).mockRejectedValue(
          new Error('No tab with id: 42')
        )
        ;(chrome.tabs.get as jest.Mock).mockRejectedValue(
          new Error('No tab with id: 42')
        )

        const response = await call({ type: 'enx:signed-in' })

        expect(response).toEqual({ ok: true, returned: true })
        expect(autoEnables()).toEqual([])
      })
    })
  })
})

// adr-039: per-site "Always enable on this site".
describe('background auto-enable wiring (adr-039)', () => {
  const listener = onMessageListener
  // Captured at collection time, before any beforeEach resetAllMocks().
  const firstListener = (event: { addListener: unknown }) =>
    (event.addListener as jest.Mock).mock.calls[0]?.[0] as () => unknown
  const onPermissionsAdded = firstListener(chrome.permissions.onAdded)
  const onPermissionsRemoved = firstListener(chrome.permissions.onRemoved)
  const onStartup = firstListener(chrome.runtime.onStartup)

  const JS = ['assets/content.tsx-loader-abc.js']

  function granted(...origins: string[]) {
    ;(chrome.permissions.getAll as jest.Mock).mockResolvedValue({
      permissions: [],
      origins,
    })
  }

  const ask = (
    sender: unknown,
    request: unknown = { action: 'shouldAutoEnable' }
  ) =>
    new Promise(resolve => {
      listener(request, sender, resolve)
    })

  beforeEach(() => {
    jest.resetAllMocks()
    __resetClerkClientCacheForTests()
    setClerkSession('clerk-session-jwt')
    ;(chrome.runtime.getManifest as jest.Mock).mockReturnValue({
      host_permissions: [],
      content_scripts: [{ matches: [], js: JS }],
    })
    ;(
      chrome.scripting.getRegisteredContentScripts as jest.Mock
    ).mockResolvedValue([])
    ;(chrome.scripting.registerContentScripts as jest.Mock).mockResolvedValue(
      undefined
    )
    granted()
  })

  it('answers true for a granted site when signed in', async () => {
    granted('https://www.infoq.com/*')
    expect(await ask({ origin: 'https://www.infoq.com' })).toEqual({
      success: true,
      autoEnable: true,
    })
  })

  it('answers false for a site that was not granted', async () => {
    expect(await ask({ origin: 'https://www.infoq.com' })).toEqual({
      success: true,
      autoEnable: false,
    })
  })

  // Auto-enabling while signed out would put a "session expired" notice on
  // every page of the site.
  it('answers false when signed out', async () => {
    granted('https://www.infoq.com/*')
    setClerkSession(null)
    expect(await ask({ origin: 'https://www.infoq.com' })).toEqual({
      success: true,
      autoEnable: false,
    })
  })

  // adr-046 Decision 7: the page stays untouched, but the badge says why.
  it('marks the tab "!" when signed out on a granted site', async () => {
    granted('https://www.infoq.com/*')
    setClerkSession(null)
    expect(
      await ask({ origin: 'https://www.infoq.com', frameId: 0, tab: { id: 4 } })
    ).toEqual({ success: true, autoEnable: false })
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({
      tabId: 4,
      text: '!',
    })
    expect(chrome.action.setTitle).toHaveBeenCalledWith({
      tabId: 4,
      title: 'Sign in to use Catglish on this site.',
    })
  })

  it('leaves the badge alone on a site that was not granted', async () => {
    setClerkSession(null)
    await ask({ origin: 'https://www.infoq.com', frameId: 0, tab: { id: 4 } })
    expect(chrome.action.setBadgeText).not.toHaveBeenCalled()
  })

  // The origin comes from Chrome's sender info, never from the message body.
  it('uses the sender origin, not a claimed one', async () => {
    granted('https://www.infoq.com/*')
    expect(
      await ask(
        { origin: 'https://evil.example' },
        { action: 'shouldAutoEnable', origin: 'https://www.infoq.com' }
      )
    ).toEqual({ success: true, autoEnable: false })
  })

  it('falls back to the sender tab URL when origin is absent', async () => {
    granted('https://www.infoq.com/*')
    expect(await ask({ tab: { url: 'https://www.infoq.com/news/1' } })).toEqual(
      { success: true, autoEnable: true }
    )
  })

  it.each([
    ['permissions.onAdded', () => onPermissionsAdded],
    ['permissions.onRemoved', () => onPermissionsRemoved],
    ['runtime.onStartup', () => onStartup],
  ])('reconciles registered scripts on %s', async (_name, get) => {
    granted('https://www.infoq.com/*')

    await get()()

    expect(chrome.scripting.registerContentScripts).toHaveBeenCalledWith([
      expect.objectContaining({ matches: ['https://www.infoq.com/*'] }),
    ])
  })

  // The popup closes under the permission dialog; the page it was opened on
  // is turned on without a second trip to the popup.
  it('turns learning mode on in the active tab of a newly granted site', async () => {
    granted('https://www.infoq.com/*')
    ;(chrome.tabs.query as jest.Mock).mockResolvedValue([
      { id: 7, url: 'https://www.infoq.com/articles/foo' },
    ])
    ;(chrome.tabs.sendMessage as jest.Mock).mockImplementation(
      async (_tabId, message) =>
        message.action === 'getLearningModeStatus'
          ? { status: { status: 'off' } }
          : { success: true }
    )

    await (
      onPermissionsAdded as (p: chrome.permissions.Permissions) => unknown
    )({ origins: ['https://www.infoq.com/*'] })

    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(7, {
      action: 'enxRun',
    })
  })
})

// ADR-069 Decision 1: the review list is a plain GET that carries no page
// text.
describe('handleGetReviewWords', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    setClerkSession('clerk-session-jwt')
    // resetAllMocks() wipes the env mock's implementation too.
    ;(chrome.storage.local.remove as jest.Mock).mockResolvedValue(undefined)
    ;(chrome.tabs.query as jest.Mock).mockResolvedValue([{ id: 1 }])
    ;(chrome.tabs.sendMessage as jest.Mock).mockResolvedValue(undefined)
    ;(global.fetch as jest.Mock) = jest.fn()
  })

  const calls = () =>
    (global.fetch as jest.Mock).mock.calls.map(([url, init]) => ({
      url,
      method: init.method,
      body: init.body,
    }))

  it('GETs the review list with no body and hands the list on as received', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse(200, [['cat', 3]])
    )

    expect(await handleGetReviewWords()).toEqual({
      success: true,
      reviewWords: [['cat', 3]],
    })
    expect(calls()).toEqual([
      {
        url: 'http://localhost:8090/api/me/review-words',
        method: 'GET',
        body: undefined,
      },
    ])
  })

  it('answers the getReviewWords message from a content script', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(jsonResponse(200, []))

    const response = await new Promise(resolve =>
      onMessageListener({ type: 'getReviewWords' }, { tab: { id: 1 } }, resolve)
    )

    expect(response).toEqual({ success: true, reviewWords: [] })
  })

  it('no longer answers the paragraph-init getWords message', async () => {
    const response = await new Promise(resolve =>
      onMessageListener(
        { type: 'getWords', paragraph: 'hello world' },
        { tab: { id: 1 } },
        resolve
      )
    )

    expect(response).toMatchObject({ success: false })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  // ADR-060 Decision 4: the content script's retry waits Retry-After.
  it("passes a rate-limit 429's code and Retry-After to the content script", async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse(
        429,
        {
          success: false,
          code: 'too_many_requests',
          message: 'Too many requests.',
        },
        false,
        { 'Retry-After': '2' }
      )
    )

    expect(await handleGetReviewWords()).toEqual({
      success: false,
      error: 'Too many requests.',
      status: 429,
      code: 'too_many_requests',
      retryAfterMs: 2000,
    })
  })
})

// adr-046: the toolbar badge, per tab.
describe('background learning-mode badge (adr-046)', () => {
  const listener = onMessageListener
  // Captured at collection time, before any beforeEach resetAllMocks().
  const onTabUpdated = (chrome.tabs.onUpdated.addListener as jest.Mock).mock
    .calls[0]?.[0] as (
    tabId: number,
    changeInfo: chrome.tabs.OnUpdatedInfo
  ) => void

  const send = (request: unknown, sender: unknown) =>
    new Promise<Record<string, unknown>>(resolve => {
      listener(request, sender, resolve as (r: unknown) => void)
    })

  beforeEach(() => {
    jest.resetAllMocks()
    ;(chrome.runtime.getManifest as jest.Mock).mockReturnValue({
      name: 'Catglish',
    })
    ;(chrome.action.getUserSettings as jest.Mock).mockResolvedValue({
      isOnToolbar: true,
    })
    ;(chrome.storage.local.get as jest.Mock).mockResolvedValue({})
    ;(chrome.storage.local.set as jest.Mock).mockResolvedValue(undefined)
  })

  it('sets the badge on the sending tab', async () => {
    const response = await send(
      { type: 'learningModeStatus', status: { status: 'processing' } },
      { tab: { id: 9 }, frameId: 0 }
    )
    expect(response).toMatchObject({ success: true })
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({
      tabId: 9,
      text: '…',
    })
  })

  it.each([
    ['a subframe', { tab: { id: 9 }, frameId: 3 }],
    ['a sender without a tab', { frameId: 0 }],
  ])('ignores a status from %s', async (_name, sender) => {
    const response = await send(
      { type: 'learningModeStatus', status: { status: 'ready' } },
      sender
    )
    expect(response).toMatchObject({ success: false })
    expect(chrome.action.setBadgeText).not.toHaveBeenCalled()
  })

  it('ignores an unknown status', async () => {
    const response = await send(
      { type: 'learningModeStatus', status: { status: 'bogus' } },
      { tab: { id: 9 }, frameId: 0 }
    )
    expect(response).toMatchObject({ success: false })
    expect(chrome.action.setBadgeText).not.toHaveBeenCalled()
  })

  it('asks the page to show the pin hint when ready and unpinned', async () => {
    ;(chrome.action.getUserSettings as jest.Mock).mockResolvedValue({
      isOnToolbar: false,
    })
    expect(
      await send(
        { type: 'learningModeStatus', status: { status: 'ready' } },
        { tab: { id: 9 }, frameId: 0 }
      )
    ).toEqual({ success: true, showPinHint: true })
  })

  it('does not ask about pinning before the article is ready', async () => {
    ;(chrome.action.getUserSettings as jest.Mock).mockResolvedValue({
      isOnToolbar: false,
    })
    expect(
      await send(
        { type: 'learningModeStatus', status: { status: 'processing' } },
        { tab: { id: 9 }, frameId: 0 }
      )
    ).toEqual({ success: true, showPinHint: false })
  })

  it('records "Don\'t show again"', async () => {
    await send({ type: 'pinHintDismissed' }, { tab: { id: 9 }, frameId: 0 })
    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      'enx-pin-hint': { shown: 0, dismissed: true },
    })
  })

  it('clears the tab badge when the tab starts loading a page', async () => {
    ;(chrome.action.setBadgeText as jest.Mock).mockResolvedValue(undefined)
    onTabUpdated(9, { status: 'loading' })
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({
      tabId: 9,
      text: '',
    })
  })

  it('leaves the badge alone on other tab updates', () => {
    onTabUpdated(9, { status: 'complete' })
    expect(chrome.action.setBadgeText).not.toHaveBeenCalled()
  })
})

// ADR-050: the Side Panel only ever exists as a tab-specific panel, and
// everything it shows is keyed by the tab it belongs to.
describe('background tab-scoped Side Panel (ADR-050)', () => {
  const listener = onMessageListener
  // Captured at collection time, before any beforeEach resetAllMocks().
  const onTabRemoved = (chrome.tabs.onRemoved.addListener as jest.Mock).mock
    .calls[0]?.[0] as (tabId: number) => void
  const onMenuClicked = (chrome.contextMenus.onClicked.addListener as jest.Mock)
    .mock.calls[0]?.[0] as (
    info: { menuItemId: string },
    tab?: { id?: number; windowId?: number }
  ) => void
  const globalSetOptionsCalls = (
    chrome.sidePanel.setOptions as jest.Mock
  ).mock.calls.slice()

  beforeEach(() => {
    jest.resetAllMocks()
    ;(chrome.storage.session.set as jest.Mock).mockResolvedValue(undefined)
    ;(chrome.storage.session.remove as jest.Mock).mockResolvedValue(undefined)
  })

  it('disables the window-wide panel when the service worker starts', () => {
    expect(globalSetOptionsCalls).toContainEqual([{ enabled: false }])
  })

  it("opens the clicked tab's own panel from the toolbar-icon menu, synchronously", () => {
    ;(chrome.sidePanel.setOptions as jest.Mock).mockResolvedValue(undefined)
    ;(chrome.sidePanel.open as jest.Mock).mockResolvedValue(undefined)

    onMenuClicked(
      { menuItemId: 'enx-open-sentence-panel' },
      { id: 7, windowId: 3 }
    )

    // No await before this point: open() must already have been called,
    // inside the menu click's user gesture.
    expect(chrome.sidePanel.setOptions).toHaveBeenCalledWith({
      tabId: 7,
      path: 'sidepanel.html?tabId=7',
      enabled: true,
    })
    expect(chrome.sidePanel.open).toHaveBeenCalledWith({ tabId: 7 })
  })

  it('ignores other menu items and menu clicks without a tab', () => {
    onMenuClicked({ menuItemId: 'something-else' }, { id: 7 })
    onMenuClicked({ menuItemId: 'enx-open-sentence-panel' }, undefined)
    expect(chrome.sidePanel.open).not.toHaveBeenCalled()
  })

  it("mirrors a page word lookup into the sending tab's key", async () => {
    const ecp = { English: 'great', Chinese: 'adj. 很好的' }
    const response = await new Promise(resolve => {
      listener(
        { type: 'recordPageWordLookup', word: 'great', ecp },
        { tab: { id: 7 } },
        resolve
      )
    })

    expect(response).toEqual({ success: true })
    expect(chrome.storage.session.set).toHaveBeenCalledWith({
      'enx-latest-page-word:7': expect.objectContaining({ word: 'great', ecp }),
    })
  })

  it('drops a page word lookup from a sender without a tab', async () => {
    const response = await new Promise(resolve => {
      listener(
        {
          type: 'recordPageWordLookup',
          word: 'great',
          ecp: { English: 'great' },
        },
        {},
        resolve
      )
    })

    expect(response).toMatchObject({ success: false })
    expect(chrome.storage.session.set).not.toHaveBeenCalled()
  })

  it("forgets a closed tab's panel state", async () => {
    expect(onTabRemoved).toBeDefined()
    onTabRemoved(7)
    expect(chrome.storage.session.remove).toHaveBeenCalledWith([
      'enx-pending-sentence:7',
      'enx-latest-page-word:7',
    ])
  })
})

// ADR-047 Decision 1: install opens, or switches back to, /welcome.
describe('background onInstalled opens /welcome (ADR-047)', () => {
  // Captured at collection time, before any beforeEach resetAllMocks().
  const onInstalled = (chrome.runtime.onInstalled.addListener as jest.Mock).mock
    .calls[0][0] as (details: { reason: string }) => Promise<void>

  beforeEach(() => {
    jest.resetAllMocks()
    __resetClerkClientCacheForTests()
    setClerkSession('clerk-session-jwt')
    ;(chrome.storage.local.set as jest.Mock).mockResolvedValue(undefined)
    ;(chrome.tabs.create as jest.Mock).mockResolvedValue({ id: 5 })
    ;(chrome.tabs.update as jest.Mock).mockResolvedValue(undefined)
    ;(chrome.windows.update as jest.Mock).mockResolvedValue(undefined)
  })

  it('opens /welcome?src=install on install when no /welcome tab is open', async () => {
    ;(chrome.tabs.query as jest.Mock).mockResolvedValue([])
    await onInstalled({ reason: 'install' })
    expect(chrome.tabs.query).toHaveBeenCalledWith({
      url: 'http://localhost:3000/welcome*',
    })
    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: 'http://localhost:3000/welcome?src=install',
    })
  })

  it('switches back to the open /welcome tab without opening another', async () => {
    ;(chrome.tabs.query as jest.Mock).mockResolvedValue([
      { id: 11, windowId: 3, url: 'http://localhost:3000/welcome' },
    ])
    await onInstalled({ reason: 'install' })
    expect(chrome.tabs.create).not.toHaveBeenCalled()
    expect(chrome.tabs.update).toHaveBeenCalledWith(11, { active: true })
    expect(chrome.windows.update).toHaveBeenCalledWith(3, { focused: true })
  })

  it('opens nothing on update', async () => {
    ;(chrome.tabs.query as jest.Mock).mockResolvedValue([])
    await onInstalled({ reason: 'update' })
    expect(chrome.tabs.create).not.toHaveBeenCalled()
    expect(chrome.tabs.update).not.toHaveBeenCalled()
  })
})

// #230: the toggle itself is learningModeCommand.ts; this only checks the
// worker hands it the shortcut's tab.
describe('background learning mode shortcut', () => {
  const onCommand = (chrome.commands.onCommand.addListener as jest.Mock).mock
    .calls[0]?.[0] as (command: string, tab?: { id?: number }) => Promise<void>

  beforeEach(() => {
    jest.resetAllMocks()
  })

  it('turns learning mode off on the shortcut tab when it is on', async () => {
    ;(chrome.tabs.sendMessage as jest.Mock).mockImplementation(
      async (_tabId: number, message: { action: string }) =>
        message.action === 'getLearningModeStatus'
          ? { status: { status: 'ready' } }
          : undefined
    )

    await onCommand(TOGGLE_LEARNING_MODE_COMMAND, { id: 9 })

    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(9, {
      action: 'enxStop',
    })
  })
})
