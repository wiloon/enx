// Re-reading the open popover's word after 中 / EN is saved (ADR-098): same
// word, no count, keep LoadCount/Known, drop late answers for another language
// or a replaced popover, and run the miss / auth-failure handlers as a click
// would. The content script owns the overlay; this owns the decision flow.

import type { createStore } from 'jotai'
import { resetAiLookup } from '@/lib/aiLookupFlow'
import { runDictionaryLookup } from '@/lib/dictionaryLookup'
import {
  isSignedOutFailure,
  isUnverifiedFailure,
  showSessionUnverified,
  showSignedOut,
} from '@/lib/signedOut'
import {
  currentWordAtom,
  errorAtom,
  errorNeedsReloadAtom,
  isTranslatingAtom,
  lookupNoticeAtom,
} from '@/store/atoms'
import type { BackgroundResponse, WordData } from '@/types'

type Store = ReturnType<typeof createStore>

export type ExplanationLanguageRereadDeps = {
  store: Store
  // Page state carried across the re-read so the count badge and Known stay.
  state?: WordData
  get: (word: string, refresh?: boolean) => Promise<BackgroundResponse>
  record: (wordId: string) => Promise<BackgroundResponse>
  isActive: () => boolean
  isCurrent: () => boolean
  // Shows the new definition in the side panel, counting nothing.
  mirror: (word: WordData) => void
  onMiss: (word: WordData) => void
}

// Invalidates an in-flight initial lookup when 中 / EN switches, and keeps
// each switch's own answers from landing after a later switch.
export function createPopoverLookupGate() {
  let generation = 0
  return {
    beginInitial() {
      const g = generation
      return { isCurrent: () => generation === g }
    },
    beginSwitch(language: string) {
      generation += 1
      const g = generation
      return {
        language,
        isCurrent: () => generation === g,
      }
    },
  }
}

export async function rereadForExplanationLanguage(
  word: string,
  language: string,
  deps: ExplanationLanguageRereadDeps
): Promise<void> {
  const { store } = deps
  resetAiLookup(store)
  store.set(isTranslatingAtom, true)
  store.set(errorAtom, null)
  store.set(lookupNoticeAtom, null)

  let accepted = false
  const wordData = await runDictionaryLookup(
    word,
    { counts: false, state: deps.state },
    {
      get: deps.get,
      record: deps.record,
      isActive: deps.isActive,
      isCurrent: deps.isCurrent,
      onDefinition: data => {
        if (
          data.ExplanationLanguage &&
          data.ExplanationLanguage !== language
        ) {
          if (deps.isCurrent()) store.set(isTranslatingAtom, false)
          return
        }
        accepted = true
        store.set(currentWordAtom, data)
        store.set(isTranslatingAtom, false)
      },
      onCounted: () => {},
      onRecordFailure: () => {},
      onFailure: response => {
        if (!deps.isCurrent()) return
        if (isSignedOutFailure(response)) {
          showSignedOut(store)
        } else if (isUnverifiedFailure(response)) {
          showSessionUnverified(store, 'lookup')
        } else {
          store.set(
            errorAtom,
            response.error || 'Translation service unavailable'
          )
          store.set(
            errorNeedsReloadAtom,
            response.extensionUpdated === true
          )
          store.set(isTranslatingAtom, false)
        }
      },
    }
  )
  if (accepted && wordData && deps.isCurrent()) {
    deps.mirror(wordData)
    deps.onMiss(wordData)
  }
}
