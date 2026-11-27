// ADR-095: a click-to-lookup in a browser that never signed in. One request
// per lookup to the anonymous endpoint, with the device id and no account
// token; the popup shows the dictionary definition only.

import type { createStore } from 'jotai'
import { entryToWordData } from '@/lib/dictionaryEntries'
import { showSignedOut } from '@/lib/signedOut'
import {
  anonymousNoticeAtom,
  currentWordAtom,
  errorAtom,
  isTranslatingAtom,
} from '@/store/atoms'
import type { WordData } from '@/types'

export const ANONYMOUS_ENTRY_PATH = '/api/anonymous/dictionary/entry'
export const ANONYMOUS_DEVICE_ID_HEADER = 'X-Enx-Device-Id'

export const ANONYMOUS_SAVE_PROMPT =
  'Sign in to save this word and see it underlined next time.'
export const ANONYMOUS_NOT_FOUND_MESSAGE =
  'No definition found. Sign in to get an AI explanation.'
const ANONYMOUS_LIMIT_FALLBACK =
  "You've reached today's limit for lookups without an account. Sign in to keep going."
const ANONYMOUS_LOOKUP_FAILED = "Couldn't look this word up. Please try again."

export type AnonymousLookup =
  | { outcome: 'found'; ecp: WordData }
  | { outcome: 'not-found' }
  | { outcome: 'limit-reached'; message: string }
  | { outcome: 'switched-off' }
  | { outcome: 'failed'; error: string }

export interface AnonymousLookupDeps {
  fetch: typeof fetch
  apiBaseUrl: string
  deviceId: () => Promise<string>
}

const readJson = async (response: Response): Promise<Record<string, unknown>> => {
  try {
    const body = await response.json()
    return body && typeof body === 'object' ? body : {}
  } catch {
    return {}
  }
}

export async function lookUpAnonymously(
  word: string,
  deps: AnonymousLookupDeps
): Promise<AnonymousLookup> {
  const requested = word.trim()
  let response: Response
  try {
    response = await deps.fetch(`${deps.apiBaseUrl}${ANONYMOUS_ENTRY_PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [ANONYMOUS_DEVICE_ID_HEADER]: await deps.deviceId(),
      },
      body: JSON.stringify({ word: requested }),
    })
  } catch {
    return { outcome: 'failed', error: ANONYMOUS_LOOKUP_FAILED }
  }

  const body = await readJson(response)
  const message = typeof body.message === 'string' ? body.message : undefined
  if (response.status === 403) return { outcome: 'switched-off' }
  if (
    response.status === 429 &&
    body.code === 'anonymous_lookup_limit_exceeded'
  ) {
    return {
      outcome: 'limit-reached',
      message: message ?? ANONYMOUS_LIMIT_FALLBACK,
    }
  }
  if (!response.ok) {
    return { outcome: 'failed', error: message ?? ANONYMOUS_LOOKUP_FAILED }
  }
  if (body.Status === 'not_found') return { outcome: 'not-found' }
  const found = body.Status === 'found' && entryToWordData(requested, body)
  if (!found) return { outcome: 'failed', error: ANONYMOUS_LOOKUP_FAILED }
  // No id: nothing is counted, marked known or kept for this word.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { Id, ...ecp } = found
  return { outcome: 'found', ecp }
}

type Store = ReturnType<typeof createStore>

// The open popup's state for an anonymous lookup's outcome.
export const showAnonymousLookup = (
  store: Store,
  result: AnonymousLookup
): void => {
  if (result.outcome === 'switched-off') {
    showSignedOut(store)
    return
  }
  store.set(isTranslatingAtom, false)
  switch (result.outcome) {
    case 'found':
      store.set(currentWordAtom, result.ecp)
      store.set(anonymousNoticeAtom, ANONYMOUS_SAVE_PROMPT)
      return
    case 'not-found':
      store.set(currentWordAtom, null)
      store.set(anonymousNoticeAtom, ANONYMOUS_NOT_FOUND_MESSAGE)
      return
    case 'limit-reached':
      store.set(currentWordAtom, null)
      store.set(anonymousNoticeAtom, result.message)
      return
    case 'failed':
      store.set(currentWordAtom, null)
      store.set(errorAtom, result.error)
  }
}
