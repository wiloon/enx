// How a lookup that found nothing becomes an AI lookup in the word popup
// (ADR-045). The content script owns the popup and its store; this decides
// what each outcome does to that store, so it can be tested without a DOM.

import type { createStore } from 'jotai'
import { aiLookupAtom, aiNoticeAtom, currentWordAtom } from '@/store/atoms'
import {
  acknowledgeAiNotice,
  lookupWithAi,
  shouldShowAiNotice,
} from '@/lib/aiLookup'
import type { WordData } from '@/types'

type Store = ReturnType<typeof createStore>

export type AiLookupDeps = {
  store: Store
  // False once this popup was closed or replaced by another lookup. The AI
  // request cannot be cancelled and still completes on the server (billed and
  // cached), but its answer must not land in a different popup.
  isCurrent: () => boolean
  // The content script's follow-ups for a word that now has a definition:
  // remember it, refresh highlights, mirror it into the side panel.
  onDefined: (word: WordData) => void
  onSessionExpired: () => void
}

// Called with the response to a lookup. A miss that carries AIFallback either
// starts the AI lookup by itself or offers a button; anything else leaves the
// popup as it was.
export const handleLookupMiss = (miss: WordData, deps: AiLookupDeps): void => {
  const fallback = miss.AIFallback
  if (miss.Chinese || !fallback) return

  if (fallback.Auto) {
    void runAiLookup(miss.English, { auto: true }, deps)
  } else {
    deps.store.set(aiLookupAtom, { status: 'offer', canUse: fallback.CanUse })
  }
}

// Runs the AI lookup for `english`. `auto` says whether it started by itself
// (then the notice may offer to stop that) or from the user's click.
export const runAiLookup = async (
  english: string,
  { auto }: { auto: boolean },
  deps: AiLookupDeps
): Promise<void> => {
  const { store } = deps
  store.set(aiLookupAtom, { status: 'loading' })

  const outcome = await lookupWithAi(english)
  if (!deps.isCurrent()) return

  switch (outcome.kind) {
    case 'found': {
      // The definition replaces the empty miss in the popup.
      store.set(currentWordAtom, { ...outcome.word })
      store.set(aiLookupAtom, { status: 'found' })
      deps.onDefined(outcome.word)
      await showNoticeOnce(auto, deps)
      return
    }
    case 'none':
      store.set(aiLookupAtom, { status: 'none' })
      return
    case 'session-expired':
      deps.onSessionExpired()
      return
    case 'error':
      store.set(aiLookupAtom, {
        status: 'error',
        reason: outcome.reason,
        ...(outcome.message ? { message: outcome.message } : {}),
      })
  }
}

// The first AI result a user ever sees comes with a notice that the word was
// sent to an AI provider. It is recorded as seen as soon as it is shown.
const showNoticeOnce = async (
  auto: boolean,
  { store, isCurrent }: AiLookupDeps
): Promise<void> => {
  if (!(await shouldShowAiNotice()) || !isCurrent()) return
  store.set(aiNoticeAtom, { show: true, offerStop: auto })
  await acknowledgeAiNotice()
}

// A fresh popup starts with no AI state left over from the last one.
export const resetAiLookup = (store: Store): void => {
  store.set(aiLookupAtom, { status: 'idle' })
  store.set(aiNoticeAtom, { show: false, offerStop: false })
}
