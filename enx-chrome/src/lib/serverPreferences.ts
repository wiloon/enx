// Per-user settings that live on the server (ADR-044), so the extension, the
// website and the server all agree. The session token lives in the background
// worker, so every call goes through it (background.ts: getPreferences /
// updatePreferences).
//
// What the server last said is also kept in chrome.storage.local -- for
// display only. The server decides what happens; the copy just lets the
// options page show something when the API can't be reached.

import { sendMessageToBackground } from '@/services/api'

// Mirrors GET/PUT /api/me/preferences. `value` is the user's explicit choice
// (null = unset); `effective` is what the server acts on, with the default and
// the user's entitlement applied -- show it, never recompute it; `editable` is
// whether the user may change it.
export type PreferenceView = {
  value: boolean | null
  effective: boolean
  editable: boolean
}

export type PreferenceKey = 'aiWordFallback' | 'aiWordFallbackNoticeAck'

export type PreferencesData = Record<PreferenceKey, PreferenceView>

// null returns a key to its default.
export type PreferenceChanges = Partial<Record<PreferenceKey, boolean | null>>

export type PreferencesResult =
  | { ok: true; data: PreferencesData }
  // 'signed-out': there is no usable session; 'unavailable': anything else
  // (API unreachable, an error response, an unexpected body).
  | { ok: false; reason: 'signed-out' | 'unavailable'; error: string }

export const PREFERENCES_CACHE_KEY = 'enx-server-preferences-cache'

type BackgroundResponse = {
  success?: boolean
  data?: unknown
  error?: string
  sessionExpired?: boolean
}

const isView = (v: unknown): v is PreferenceView => {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return (
    (o.value === null || typeof o.value === 'boolean') &&
    typeof o.effective === 'boolean' &&
    typeof o.editable === 'boolean'
  )
}

const isPreferences = (d: unknown): d is PreferencesData =>
  !!d &&
  typeof d === 'object' &&
  isView((d as Record<string, unknown>).aiWordFallback) &&
  isView((d as Record<string, unknown>).aiWordFallbackNoticeAck)

const toResult = async (
  request: Promise<BackgroundResponse | undefined>
): Promise<PreferencesResult> => {
  let response: BackgroundResponse | undefined
  try {
    response = await request
  } catch (error) {
    return {
      ok: false,
      reason: 'unavailable',
      error: error instanceof Error ? error.message : 'Request failed',
    }
  }
  if (response?.sessionExpired) {
    return {
      ok: false,
      reason: 'signed-out',
      error: response.error || 'Not signed in',
    }
  }
  if (!response?.success) {
    return {
      ok: false,
      reason: 'unavailable',
      error: response?.error || 'Could not reach the server',
    }
  }
  if (!isPreferences(response.data)) {
    return {
      ok: false,
      reason: 'unavailable',
      error: 'The server sent an unexpected response',
    }
  }
  await writeCache(response.data)
  return { ok: true, data: response.data }
}

export const fetchPreferences = (): Promise<PreferencesResult> =>
  toResult(sendMessageToBackground({ type: 'getPreferences' }))

export const updatePreferences = (
  changes: PreferenceChanges
): Promise<PreferencesResult> =>
  toResult(sendMessageToBackground({ type: 'updatePreferences', changes }))

const writeCache = async (data: PreferencesData): Promise<void> => {
  try {
    await chrome.storage.local.set({ [PREFERENCES_CACHE_KEY]: data })
  } catch (error) {
    console.warn('[ENX Config] failed to cache server preferences:', error)
  }
}

// The last preferences the server returned on this device, or null.
export const readCachedPreferences =
  async (): Promise<PreferencesData | null> => {
    try {
      const result = await chrome.storage.local.get<{
        [PREFERENCES_CACHE_KEY]?: unknown
      }>(PREFERENCES_CACHE_KEY)
      const cached = result[PREFERENCES_CACHE_KEY]
      return isPreferences(cached) ? cached : null
    } catch (error) {
      console.warn('[ENX Config] failed to read cached preferences:', error)
      return null
    }
  }
