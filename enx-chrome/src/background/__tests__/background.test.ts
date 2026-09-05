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
import { makeApiRequest } from '../background'

// Captured at import time, before any test's resetAllMocks() wipes the
// addListener call history: importing ../background registers this as a
// top-level side effect.
const onMessageListener = (chrome.runtime.onMessage.addListener as jest.Mock)
  .mock.calls[0][0] as (
  request: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void
) => boolean

function jsonResponse(status: number, body: unknown, ok = status < 400) {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Unauthorized',
    json: async () => body,
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

  it('reports session-expired on a 401 without retrying', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue(jsonResponse(401, {}))

    const result = await makeApiRequest('/api/translate?word=test')

    expect(result).toEqual({
      success: false,
      error: 'Your session has expired. Please login again.',
      sessionExpired: true,
    })
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ action: 'sessionExpired' })
    )
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
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(jsonResponse(401, {}))

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
