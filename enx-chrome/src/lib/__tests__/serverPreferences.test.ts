import {
  PREFERENCES_CACHE_KEY,
  fetchPreferences,
  readCachedPreferences,
  updatePreferences,
  type PreferencesData,
} from '@/lib/serverPreferences'
import { sendMessageToBackground } from '@/services/api'

jest.mock('@/services/api', () => ({ sendMessageToBackground: jest.fn() }))

const send = sendMessageToBackground as jest.Mock
const storage = chrome.storage.local as unknown as {
  get: jest.Mock
  set: jest.Mock
}

const view = (effective: boolean, editable = true) => ({
  value: null,
  effective,
  editable,
})
const prefs = (aiOn: boolean): PreferencesData => ({
  aiWordFallback: view(aiOn),
  aiWordFallbackNoticeAck: view(false),
})

beforeEach(() => {
  jest.resetAllMocks()
  storage.set.mockResolvedValue(undefined)
})

describe('fetchPreferences', () => {
  it('asks the background for the preferences and returns them', async () => {
    send.mockResolvedValue({ success: true, data: prefs(true) })

    expect(await fetchPreferences()).toEqual({ ok: true, data: prefs(true) })
    expect(send).toHaveBeenCalledWith({ type: 'getPreferences' })
  })

  it('remembers what the server said, for display when it is unreachable', async () => {
    send.mockResolvedValue({ success: true, data: prefs(true) })
    await fetchPreferences()

    expect(storage.set).toHaveBeenCalledWith({
      [PREFERENCES_CACHE_KEY]: prefs(true),
    })
  })

  it('maps an expired session to signed-out, not to a generic failure', async () => {
    send.mockResolvedValue({
      success: false,
      sessionExpired: true,
      error: 'Your session has expired. Please login again.',
    })

    expect(await fetchPreferences()).toMatchObject({
      ok: false,
      reason: 'signed-out',
    })
  })

  it.each([
    ['an error response', { success: false, error: 'HTTP 500' }, 'HTTP 500'],
    ['no response at all', undefined, 'Could not reach the server'],
    [
      'a body that is not the preferences',
      { success: true, data: { aiWordFallback: 'on' } },
      'The server sent an unexpected response',
    ],
  ])('treats %s as unavailable', async (_name, response, error) => {
    send.mockResolvedValue(response)

    expect(await fetchPreferences()).toEqual({
      ok: false,
      reason: 'unavailable',
      error,
    })
    expect(storage.set).not.toHaveBeenCalled()
  })

  it('treats a failed message to the background as unavailable', async () => {
    send.mockRejectedValue(new Error('Extension context invalidated'))

    expect(await fetchPreferences()).toEqual({
      ok: false,
      reason: 'unavailable',
      error: 'Extension context invalidated',
    })
  })
})

describe('updatePreferences', () => {
  it('sends the partial change and returns the full set the server answers', async () => {
    send.mockResolvedValue({ success: true, data: prefs(false) })

    expect(await updatePreferences({ aiWordFallback: false })).toEqual({
      ok: true,
      data: prefs(false),
    })
    expect(send).toHaveBeenCalledWith({
      type: 'updatePreferences',
      changes: { aiWordFallback: false },
    })
  })

  it('surfaces the server message when the change is refused', async () => {
    send.mockResolvedValue({
      success: false,
      status: 403,
      error:
        'This setting is available with a subscription or a credit balance.',
    })

    expect(await updatePreferences({ aiWordFallback: true })).toEqual({
      ok: false,
      reason: 'unavailable',
      error:
        'This setting is available with a subscription or a credit balance.',
    })
  })
})

describe('readCachedPreferences', () => {
  it('returns what was last cached', async () => {
    storage.get.mockResolvedValue({ [PREFERENCES_CACHE_KEY]: prefs(true) })

    expect(await readCachedPreferences()).toEqual(prefs(true))
  })

  it.each([
    ['nothing cached', {}],
    ['a corrupted entry', { [PREFERENCES_CACHE_KEY]: { aiWordFallback: 1 } }],
  ])('returns null for %s', async (_name, stored) => {
    storage.get.mockResolvedValue(stored)

    expect(await readCachedPreferences()).toBeNull()
  })

  it('returns null when storage throws', async () => {
    storage.get.mockRejectedValue(new Error('storage unavailable'))

    expect(await readCachedPreferences()).toBeNull()
  })
})
