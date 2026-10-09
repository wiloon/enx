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

jest.mock('@clerk/chrome-extension/client', () => ({
  createClerkClient: jest.fn(),
}))

import { createClerkClient } from '@clerk/chrome-extension/client'
import { getApiBaseUrl } from '@/config/env'
import {
  makeApiRequest,
  handleGetWords,
  __resetClerkClientCacheForTests,
  __resetParagraphMethodForTests,
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
    ;(getApiBaseUrl as jest.Mock).mockResolvedValue('http://localhost:8090')
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
    ;(getApiBaseUrl as jest.Mock).mockResolvedValue('http://localhost:8090')
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
      jsonResponse(status, { message }, false)
    )

    const response = await call({ type: 'defineWordWithAI', word: 'rizzler' })

    expect(response).toEqual({ success: false, error: message, status })
  })

  it('reports session expiry on a 401', async () => {
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
          sourceUrl: 'https://example.com/post',
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
          sourceUrl: 'https://example.com/post',
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
          sourceUrl: 'https://example.com/post',
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
      title: 'Sign in to Catglish to use learning mode on this site.',
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
})

// ADR-041: paragraph-init sends page text in a body, via QUERY by default and
// POST where the user's network rejects QUERY.
describe('handleGetWords (paragraph-init method)', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    setClerkSession('clerk-session-jwt')
    __resetParagraphMethodForTests()
    // resetAllMocks() wipes the env mock's implementation too.
    ;(getApiBaseUrl as jest.Mock).mockResolvedValue('http://localhost:8090')
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

  it('sends QUERY with the paragraph in a JSON body, not the URL', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse(200, { data: { hello: { Id: 'w1' } } })
    )

    const result = await handleGetWords('hello world')

    expect(result).toEqual({
      success: true,
      wordProperties: { data: { hello: { Id: 'w1' } } },
    })
    expect(calls()).toEqual([
      {
        url: 'http://localhost:8090/api/paragraph-init',
        method: 'QUERY',
        body: JSON.stringify({ paragraph: 'hello world' }),
      },
    ])
  })

  it.each([
    [
      'a network-level failure',
      () => Promise.reject(new TypeError('Failed to fetch')),
    ],
    ['405 from a proxy', () => Promise.resolve(jsonResponse(405, {}))],
    ['501 from a proxy', () => Promise.resolve(jsonResponse(501, {}))],
  ])(
    'falls back to POST after %s, and stays on POST',
    async (_, firstReply) => {
      ;(global.fetch as jest.Mock)
        .mockImplementationOnce(firstReply)
        .mockResolvedValueOnce(jsonResponse(200, { data: {} }))
        .mockResolvedValueOnce(jsonResponse(200, { data: {} }))

      expect((await handleGetWords('hello')).success).toBe(true)
      expect(calls().map(c => c.method)).toEqual(['QUERY', 'POST'])

      await handleGetWords('world')
      expect(calls().map(c => c.method)).toEqual(['QUERY', 'POST', 'POST'])
    }
  )

  it('keeps using QUERY when the POST retry fails too (e.g. the API is down)', async () => {
    ;(global.fetch as jest.Mock)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse(200, { data: {} }))

    expect((await handleGetWords('hello')).success).toBe(false)
    await handleGetWords('world')
    expect(calls().map(c => c.method)).toEqual(['QUERY', 'POST', 'QUERY'])
  })

  it.each([
    ['a server error', 500],
    ['a quota rejection', 429],
  ])('does not fall back on %s', async (_, status) => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(jsonResponse(status, {}))

    expect((await handleGetWords('hello')).success).toBe(false)
    expect(calls().map(c => c.method)).toEqual(['QUERY'])
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
