// The AI word fallback as the extension sees it (ADR-045). When a lookup finds
// nothing, the server says what it offers (WordData.AIFallback); this file
// sends the second request, maps its outcome, and handles the one-time notice
// that the word is sent to an AI provider.

import { config } from '@/config/env'
import { fetchPreferences, updatePreferences } from '@/lib/serverPreferences'
import { sendMessageToBackground } from '@/services/api'
import type { BackgroundResponse, WordData } from '@/types'

export type AiLookupOutcome =
  | { kind: 'found'; word: WordData }
  // The AI has no definition for it.
  | { kind: 'none' }
  | { kind: 'session-expired' }
  | {
      kind: 'error'
      reason: 'credit' | 'rate-limited' | 'not-entitled' | 'unavailable'
    }

// Defines `word` with AI. Only the word is sent -- never the sentence or the
// page (the server accepts nothing else). The request cannot be cancelled: once
// sent it is billed and cached however the popover is used afterwards.
export const lookupWithAi = async (word: string): Promise<AiLookupOutcome> => {
  let response: BackgroundResponse | undefined
  try {
    response = await sendMessageToBackground<BackgroundResponse>({
      type: 'defineWordWithAI',
      word,
    })
  } catch {
    return { kind: 'error', reason: 'unavailable' }
  }

  if (response?.sessionExpired) return { kind: 'session-expired' }

  if (response?.success) {
    const body = response.data as
      { found?: boolean; word?: WordData } | undefined
    return body?.found && body.word
      ? { kind: 'found', word: body.word }
      : { kind: 'none' }
  }

  switch (response?.status) {
    case 402:
      return { kind: 'error', reason: 'credit' }
    case 429:
      return { kind: 'error', reason: 'rate-limited' }
    case 403:
      return { kind: 'error', reason: 'not-entitled' }
    default:
      return { kind: 'error', reason: 'unavailable' }
  }
}

// enx-ui's billing page, opened in a new tab. `src` says which button sent the
// user, for conversion stats; it never carries the word.
export const billingUrl = (src: 'lookup-miss' | 'ai-credit'): string =>
  `${config.frontendBaseUrl}/billing?src=${src}`

// Whether the one-time notice has been seen is stored on the server, so it is
// shown once per account, not once per device. This device remembers a "seen"
// answer locally so a page load does not have to ask again.
export const AI_NOTICE_SEEN_KEY = 'enx-ai-notice-seen'

export const shouldShowAiNotice = async (): Promise<boolean> => {
  try {
    const local = await chrome.storage.local.get<{
      [AI_NOTICE_SEEN_KEY]?: boolean
    }>(AI_NOTICE_SEEN_KEY)
    if (local[AI_NOTICE_SEEN_KEY]) return false
  } catch (error) {
    console.warn('[ENX] could not read the AI notice flag:', error)
  }

  const result = await fetchPreferences()
  if (result.ok && result.data.aiWordFallbackNoticeAck.effective) {
    await rememberNoticeSeen()
    return false
  }
  // Not yet seen -- or the server could not be asked, in which case showing it
  // once more is better than not showing it.
  return true
}

// Records on the server (and on this device) that the notice was shown.
export const acknowledgeAiNotice = async (): Promise<void> => {
  await rememberNoticeSeen()
  await updatePreferences({ aiWordFallbackNoticeAck: true })
}

const rememberNoticeSeen = async (): Promise<void> => {
  try {
    await chrome.storage.local.set({ [AI_NOTICE_SEEN_KEY]: true })
  } catch (error) {
    console.warn('[ENX] could not store the AI notice flag:', error)
  }
}

// "Stop using AI automatically": turns the server-side switch off. Returns
// whether the server accepted it.
export const stopAutomaticAiLookup = async (): Promise<boolean> =>
  (await updatePreferences({ aiWordFallback: false })).ok
