// Avoid loading the real env.ts (uses `import.meta`, which ts-jest can't parse
// under CommonJS).
jest.mock('@/config/env', () => ({
  config: {
    apiBaseUrl: 'http://localhost:8090',
    frontendBaseUrl: 'http://localhost:3000',
    clerkPublishableKey: 'pk_test_x',
    clerkSyncHost: 'http://localhost:3000',
    environment: 'test',
  },
  getApiBaseUrl: jest.fn(async () => 'http://localhost:8090'),
}))

// Fake Clerk client (ADR-015): the background mints a session JWT via
// clerk.session.getToken(). `setClerkSession` controls what it returns.
const getToken = jest.fn<Promise<string | null>, []>()
let clerkSession: { getToken: typeof getToken } | null = { getToken }

// Re-installed on every setClerkSession() call because it runs after each
// describe block's jest.resetAllMocks(), which wipes mockImplementation --
// see the "Captured at import time" comment below for the same gotcha.
function installCreateClerkClientMock() {
  ;(createClerkClient as jest.Mock).mockImplementation(async () => ({
    get session() {
      return clerkSession
    },
  }))
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

jest.mock('@clerk/chrome-extension/background', () => ({
  createClerkClient: jest.fn(),
}))

import { createClerkClient } from '@clerk/chrome-extension/background'
import { makeApiRequest, __resetClerkClientCacheForTests } from '../background'

// Captured at import time, before any test's resetAllMocks() wipes the
// addListener call history: importing ../background registers this as a
// top-level side effect.
const onMessageListener = (chrome.runtime.onMessage.addListener as jest.Mock)
  .mock.calls[0][0] as (
  request: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void
) => boolean

// ADR-019: the one web -> extension channel. enx-ui (an externally_connectable
// origin) is the only caller.
const onMessageExternalListener = (
  chrome.runtime.onMessageExternal.addListener as jest.Mock
).mock.calls[0][0] as (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void
) => boolean | void

function jsonResponse(status: number, body: unknown, ok = status < 400) {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Unauthorized',
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  }
}

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

  it('sends no Authorization header when there is no Clerk session', async () => {
    setClerkSession(null)
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(jsonResponse(200, {}))

    await makeApiRequest('/api/me')

    const [, requestInit] = (global.fetch as jest.Mock).mock.calls[0]
    expect(requestInit.headers.Authorization).toBeUndefined()
  })

  it('force-refreshes the token once on a 401, then reports session-expired if it persists', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue(jsonResponse(401, {}))

    const result = await makeApiRequest('/api/translate?word=test')

    expect(result).toEqual({
      success: false,
      error: 'Your session has expired. Please login again.',
      sessionExpired: true,
    })
    // Attempt 1 (cached token) + attempt 2 (skipCache token).
    expect(global.fetch).toHaveBeenCalledTimes(2)
    expect(getToken).toHaveBeenNthCalledWith(2, { skipCache: true })
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ action: 'sessionExpired' })
    )
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

  it('does not retry a 401 when it never had a token to refresh', async () => {
    setClerkSession(null)
    ;(global.fetch as jest.Mock).mockResolvedValue(jsonResponse(401, {}))

    const result = await makeApiRequest('/api/translate?word=test')

    expect(result).toEqual({
      success: false,
      error: 'Your session has expired. Please login again.',
      sessionExpired: true,
    })
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('propagates a non-401 error status (e.g. 402 insufficient credit)', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse(402, { message: '积分不足' })
    )

    const result = await makeApiRequest('/api/translate/sentence', {
      method: 'POST',
    })

    expect(result).toEqual({
      success: false,
      error: '积分不足',
      status: 402,
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

  it('reports a real session expiry when the retried client is also empty', async () => {
    setClerkSession(null)
    ;(createClerkClient as jest.Mock).mockImplementationOnce(async () => ({
      session: null,
    }))
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(jsonResponse(200, {}))

    await makeApiRequest('/api/me')

    const [, requestInit] = (global.fetch as jest.Mock).mock.calls[0]
    expect(requestInit.headers.Authorization).toBeUndefined()
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
// PendingSentenceContext.
describe('background onMessage / openSentencePanel phrase passthrough (ADR-008)', () => {
  const listener = onMessageListener

  beforeEach(() => {
    jest.resetAllMocks()
    setClerkSession('clerk-session-jwt')
    ;(chrome.storage.session.set as jest.Mock).mockResolvedValue(undefined)
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
          sourceUrl: 'https://example.com/post',
        },
        { tab: { id: 7 } },
        resolve
      )
    })

    expect(response).toEqual({ success: true, panelOpened: true })
    expect(chrome.storage.session.set).toHaveBeenCalledWith(
      expect.objectContaining({
        'enx-pending-sentence': expect.objectContaining({
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
          sourceUrl: 'https://example.com/post',
        },
        { tab: { id: 7 } },
        resolve
      )
    })

    expect(response).toEqual({ success: true, panelOpened: true })
    expect(chrome.sidePanel.open).toHaveBeenCalledWith({ tabId: 7 })
    expect(calls).toEqual(['sidePanel.open', 'storage.session.set'])
  })

  it('falls back to a getContexts() probe when the gesture did not forward', async () => {
    ;(chrome.sidePanel.open as jest.Mock).mockRejectedValue(
      new Error('sidePanel.open() may only be called in response to a user gesture')
    )
    ;(chrome.runtime.getContexts as jest.Mock).mockResolvedValue([
      { contextType: 'BACKGROUND' },
      { contextType: 'SIDE_PANEL', windowId: 999 },
    ])

    const response = await new Promise(resolve => {
      listener(
        {
          type: 'openSentencePanel',
          word: 'great',
          sentence: 'Cats are great pets.',
          sourceUrl: 'https://example.com/post',
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
      new Error('sidePanel.open() may only be called in response to a user gesture')
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
          sourceUrl: 'https://example.com/post',
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
          sourceUrl: 'https://example.com/post',
        },
        { tab: { id: 7 } },
        resolve
      )
    })

    expect(response).toEqual({ success: true, panelOpened: true })
    expect(chrome.storage.session.set).toHaveBeenCalledWith(
      expect.objectContaining({
        'enx-pending-sentence': expect.objectContaining({
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
      jsonResponse(200, { success: true, chinese: '猫是很棒的宠物。', wordChinese: '极好的' })
    )

    const response = await send({
      type: 'translateSentenceWithWord',
      sentence: 'Cats are great pets.',
      word: 'great',
    })

    expect(response).toEqual({ success: true, chinese: '猫是很棒的宠物。', wordChinese: '极好的' })
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toContain('/api/translate/sentence-with-word')
    expect(JSON.parse(init.body)).toEqual({ sentence: 'Cats are great pets.', word: 'great' })
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

    expect(response).toEqual({ success: true, chinese: '猫是很棒的宠物。', wordChinese: '' })
  })

  it('propagates the HTTP status on failure (e.g. 402 insufficient credit)', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse(402, { success: false, message: '积分不足，请充值或订阅' })
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

    expect(response).toEqual({ success: false, error: 'sentence and word are required' })
    expect(global.fetch).not.toHaveBeenCalled()
  })
})

describe('background onMessageExternal (ADR-019 web -> extension channel)', () => {
  const external = onMessageExternalListener

  beforeEach(() => {
    jest.resetAllMocks()
    __resetClerkClientCacheForTests()
    setClerkSession('clerk-session-jwt')
    ;(chrome.runtime.getManifest as jest.Mock).mockReturnValue({ version: '1.2.3' })
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

  it('runs enxRun on the sender tab for enx:enable-reader when signed in', async () => {
    const response = await call({ type: 'enx:enable-reader' })
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(7, { action: 'enxRun' })
    expect(response).toEqual({ ok: true })
  })

  it('refuses enx:enable-reader when signed out, without touching the tab', async () => {
    setClerkSession(null)
    const response = await call({ type: 'enx:enable-reader' })
    expect(response).toEqual({ ok: false, reason: 'signed-out' })
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled()
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
        'enx-signin-return': { ...pending, createdAt: Date.now() - 20 * 60_000 },
      })

      const response = await call({ type: 'enx:signed-in' })

      expect(response).toEqual({ ok: true, returned: false })
      expect(chrome.tabs.remove).not.toHaveBeenCalled()
      expect(chrome.storage.session.remove).toHaveBeenCalledWith(
        'enx-signin-return'
      )
    })
  })
})
