import {
  AI_NOTICE_SEEN_KEY,
  acknowledgeAiNotice,
  billingUrl,
  lookupWithAi,
  shouldShowAiNotice,
  stopAutomaticAiLookup,
} from '@/lib/aiLookup'
import {
  fetchPreferences,
  updatePreferences,
  type PreferencesData,
} from '@/lib/serverPreferences'
import { sendMessageToBackground } from '@/services/api'

jest.mock('@/services/api', () => ({ sendMessageToBackground: jest.fn() }))
jest.mock('@/lib/serverPreferences', () => ({
  fetchPreferences: jest.fn(),
  updatePreferences: jest.fn(),
}))
jest.mock('@/config/env', () => ({
  config: { frontendBaseUrl: 'https://enx.example.test' },
}))

const send = sendMessageToBackground as jest.Mock
const fetchPrefs = fetchPreferences as jest.Mock
const updatePrefs = updatePreferences as jest.Mock
const storage = chrome.storage.local as unknown as {
  get: jest.Mock
  set: jest.Mock
}

const view = (effective: boolean) => ({
  value: null,
  effective,
  editable: true,
})
const prefs = (noticeAck: boolean): PreferencesData => ({
  aiWordFallback: view(true),
  aiWordFallbackNoticeAck: view(noticeAck),
})

beforeEach(() => {
  jest.resetAllMocks()
  storage.get.mockResolvedValue({})
  storage.set.mockResolvedValue(undefined)
})

describe('lookupWithAi', () => {
  it('sends only the word, and returns the definition', async () => {
    const word = { English: 'rizzler', Chinese: 'n. 很有魅力的人' }
    send.mockResolvedValue({ success: true, data: { found: true, word } })

    expect(await lookupWithAi('rizzler')).toEqual({ kind: 'found', word })
    expect(send).toHaveBeenCalledWith({
      type: 'defineWordWithAI',
      word: 'rizzler',
    })
  })

  it.each([
    ['the AI has no definition', { found: false, reason: 'no_definition' }],
    ['a found answer with no word', { found: true }],
    ['no body at all', undefined],
  ])('maps %s to none', async (_name, data) => {
    send.mockResolvedValue({ success: true, data })

    expect(await lookupWithAi('asdfgh')).toEqual({ kind: 'none' })
  })

  it('maps an expired session', async () => {
    send.mockResolvedValue({ success: false, sessionExpired: true })

    expect(await lookupWithAi('rizzler')).toEqual({ kind: 'session-expired' })
  })

  it.each([
    [402, 'credit'],
    [403, 'not-entitled'],
    [502, 'unavailable'],
    [503, 'unavailable'],
    [undefined, 'unavailable'],
  ])('maps HTTP %s to %s', async (status, reason) => {
    send.mockResolvedValue({ success: false, status, error: 'x' })

    expect(await lookupWithAi('rizzler')).toEqual({ kind: 'error', reason })
  })

  // A 429 is either the AI lookup's own rate limit or the sign-up trial's
  // daily limit (ADR-048); the server's message says which, so it is kept.
  it('keeps the server message on a 429', async () => {
    const message =
      "You've reached today's trial limit. Try again tomorrow, or subscribe for more."
    send.mockResolvedValue({ success: false, status: 429, error: message })

    expect(await lookupWithAi('rizzler')).toEqual({
      kind: 'error',
      reason: 'rate-limited',
      message,
    })
  })

  it('treats a message that never got an answer as unavailable', async () => {
    send.mockRejectedValue(new Error('Extension context invalidated'))
    expect(await lookupWithAi('rizzler')).toEqual({
      kind: 'error',
      reason: 'unavailable',
    })

    send.mockResolvedValue(undefined)
    expect(await lookupWithAi('rizzler')).toEqual({
      kind: 'error',
      reason: 'unavailable',
    })
  })
})

describe('billingUrl', () => {
  it('points at the billing page and says where the user came from', () => {
    expect(billingUrl('lookup-miss')).toBe(
      'https://enx.example.test/billing?src=lookup-miss'
    )
    expect(billingUrl('ai-credit')).toBe(
      'https://enx.example.test/billing?src=ai-credit'
    )
  })
})

describe('the one-time notice', () => {
  it('is shown when the server has not seen it acknowledged', async () => {
    fetchPrefs.mockResolvedValue({ ok: true, data: prefs(false) })

    expect(await shouldShowAiNotice()).toBe(true)
  })

  it('is not shown, and not asked about again, once this device knows it was seen', async () => {
    storage.get.mockResolvedValue({ [AI_NOTICE_SEEN_KEY]: true })

    expect(await shouldShowAiNotice()).toBe(false)
    expect(fetchPrefs).not.toHaveBeenCalled()
  })

  it('is not shown when another device already acknowledged it, and that is remembered', async () => {
    fetchPrefs.mockResolvedValue({ ok: true, data: prefs(true) })

    expect(await shouldShowAiNotice()).toBe(false)
    expect(storage.set).toHaveBeenCalledWith({ [AI_NOTICE_SEEN_KEY]: true })
  })

  it('is shown when the server cannot be asked: once too often beats never', async () => {
    fetchPrefs.mockResolvedValue({
      ok: false,
      reason: 'unavailable',
      error: 'x',
    })

    expect(await shouldShowAiNotice()).toBe(true)
  })

  it('is acknowledged on this device and on the server', async () => {
    updatePrefs.mockResolvedValue({ ok: true, data: prefs(true) })

    await acknowledgeAiNotice()

    expect(storage.set).toHaveBeenCalledWith({ [AI_NOTICE_SEEN_KEY]: true })
    expect(updatePrefs).toHaveBeenCalledWith({ aiWordFallbackNoticeAck: true })
  })

  it('still shows when the local flag cannot be read', async () => {
    storage.get.mockRejectedValue(new Error('storage unavailable'))
    fetchPrefs.mockResolvedValue({ ok: true, data: prefs(false) })

    expect(await shouldShowAiNotice()).toBe(true)
  })
})

describe('stopAutomaticAiLookup', () => {
  it('turns the server-side switch off and reports whether it took', async () => {
    updatePrefs.mockResolvedValue({ ok: true, data: prefs(true) })
    expect(await stopAutomaticAiLookup()).toBe(true)
    expect(updatePrefs).toHaveBeenCalledWith({ aiWordFallback: false })

    updatePrefs.mockResolvedValue({
      ok: false,
      reason: 'unavailable',
      error: 'x',
    })
    expect(await stopAutomaticAiLookup()).toBe(false)
  })
})
