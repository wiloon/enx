// ADR-090: the Side Panel's card list lives in chrome.storage.session, one
// copy per reading tab, shared by every panel document of that tab. Every
// write is a locked read-modify-write that returns the committed request
// plan (or none): allocation of tokens, retry decisions and card transitions
// all happen here, on the state read under the lock. I/O enters through the
// constructor.

import {
  PANEL_REQUEST_TIMEOUT_MS,
  adjacentPageCard,
  findCard,
  findSentence,
  isCardLoading,
  moveSentenceToTop,
  patchCard,
  patchSentence,
  removeCard,
  reorderOrInsertCard,
  sentenceCardId,
  sweepTimedOut,
  topLevelPhraseCardKey,
  upsertPageLookupCard,
  wordCardKey,
  type PanelEntry,
  type WordCardData,
} from './panelHistory'

export const PANEL_HISTORY_KEY_PREFIX = 'enx-panel-history'
export const PANEL_HISTORY_MAX_ENTRIES = 100
export const PANEL_HISTORY_MAX_CLAIMS = 20
export const PANEL_HISTORY_UNDO_MS = 5000

export const panelHistoryKey = (tabId: number): string =>
  `${PANEL_HISTORY_KEY_PREFIX}:${tabId}`

export const panelHistoryLockName = (tabId: number): string =>
  panelHistoryKey(tabId)

export type StoredCleared = {
  generation: number
  entries: PanelEntry[]
  expiresAt: number
}

export type StoredPanelHistory = {
  entries: PanelEntry[]
  cleared: StoredCleared | null
  nextToken: number
  claimedSentenceEventIds: string[]
  claimedPageWordEventIds: string[]
  clearGeneration: number
}

export const emptyPanelHistory = (): StoredPanelHistory => ({
  entries: [],
  cleared: null,
  nextToken: 0,
  claimedSentenceEventIds: [],
  claimedPageWordEventIds: [],
  clearGeneration: 0,
})

export type PlannedRequest =
  | {
      type: 'translateSentence'
      sentenceId: string
      sentence: string
      token: number
    }
  | {
      type: 'fetchWordContext'
      word: string
      sentence: string
      sentenceId: string | undefined
      key: string
      token: number
      counts: boolean
    }
  | {
      type: 'fetchContextTranslation'
      word: string
      sentence: string
      sentenceId: string | undefined
      key: string
      token: number
      dictionaryChinese?: string
    }
  | {
      type: 'fetchDictionary'
      word: string
      sentenceId: string | undefined
      key: string
      token: number
    }

export type TransactionOutcome = {
  /** False when the tab is gone or the storage write failed. */
  committed: boolean
  plan: PlannedRequest[]
  state: StoredPanelHistory
}

export type SessionStorageArea = {
  get: (key: string) => Promise<StoredPanelHistory | undefined>
  set: (key: string, value: StoredPanelHistory) => Promise<void>
  remove: (key: string) => Promise<void>
}

export type LockRequest = <T>(
  name: string,
  callback: () => Promise<T>
) => Promise<T>

export type PanelHistoryStoreDeps = {
  storage: SessionStorageArea
  requestLock: LockRequest
  tabExists: (tabId: number) => Promise<boolean>
  now: () => number
  /** Test seam: shortens the 120 s request timeout (ADR-090 Decision 5). */
  requestTimeoutMs?: number
}

export type Mutator = (
  state: StoredPanelHistory,
  now: number
) => {
  /** Return the received state object itself for "nothing to change". */
  state: StoredPanelHistory
  plan?: PlannedRequest[]
}

type Draft = { state: StoredPanelHistory; plan: PlannedRequest[] }

const expireCleared = (
  state: StoredPanelHistory,
  now: number
): StoredPanelHistory => {
  if (!state.cleared) return state
  if (state.cleared.expiresAt > now) return state
  return { ...state, cleared: null }
}

const pushClaim = (ids: string[], eventId: string): string[] => {
  const next = [...ids.filter(id => id !== eventId), eventId]
  return next.slice(-PANEL_HISTORY_MAX_CLAIMS)
}

const allocateToken = (
  state: StoredPanelHistory
): { state: StoredPanelHistory; token: number } => {
  const token = state.nextToken + 1
  return { state: { ...state, nextToken: token }, token }
}

const trimToCap = (entries: PanelEntry[]): PanelEntry[] =>
  entries.length <= PANEL_HISTORY_MAX_ENTRIES
    ? entries
    : entries.slice(0, PANEL_HISTORY_MAX_ENTRIES)

const isFailedCard = (card: WordCardData): boolean =>
  card.contextStatus === 'error' || card.dictionaryStatus === 'error'

// Retries a failed word/phrase card with a new token: the context half alone
// when the dictionary half is done (or never applies), otherwise the whole
// dictionary-first chain.
const retryCard = (
  state: StoredPanelHistory,
  sentenceId: string | undefined,
  card: WordCardData,
  sentence: string,
  now: number
): Draft => {
  const alloc = allocateToken(state)
  const token = alloc.token
  const contextOnly =
    card.dictionaryStatus === 'none' || card.dictionaryStatus === 'loaded'
  const entries = patchCard(alloc.state.entries, sentenceId, card.key, {
    token,
    startedAt: now,
    contextStatus: 'loading',
    contextError: undefined,
    contextErrorHttpStatus: undefined,
    contextSessionExpired: false,
    contextSessionUnverified: false,
    ...(contextOnly
      ? {}
      : {
          dictionaryStatus: 'loading' as const,
          dictionaryError: undefined,
          dictionarySessionExpired: false,
          dictionarySessionUnverified: false,
        }),
  })
  const request: PlannedRequest = contextOnly
    ? {
        type: 'fetchContextTranslation',
        word: card.word,
        sentence,
        sentenceId,
        key: card.key,
        token,
        dictionaryChinese:
          card.dictionaryStatus === 'loaded' ? card.dictionaryChinese : undefined,
      }
    : {
        type: 'fetchWordContext',
        word: card.word,
        sentence,
        sentenceId,
        key: card.key,
        token,
        counts: false,
      }
  return { state: { ...alloc.state, entries }, plan: [request] }
}

export type SentenceEventInput = {
  eventId: string
  sentence: string
  word: string
  phrase?: string
  wordStates?: Record<string, import('@/types').WordData>
}

export type PageWordEventInput = {
  eventId: string
  word: string
  ecp: import('@/types').WordData
}

const claimSentence = (
  start: StoredPanelHistory,
  event: SentenceEventInput,
  now: number
): Draft => {
  if (start.claimedSentenceEventIds.includes(event.eventId)) {
    return { state: start, plan: [] }
  }
  let state: StoredPanelHistory = {
    ...start,
    claimedSentenceEventIds: pushClaim(
      start.claimedSentenceEventIds,
      event.eventId
    ),
  }
  const plan: PlannedRequest[] = []

  if (event.phrase) {
    const keyForPhrase = topLevelPhraseCardKey(event.phrase, event.sentence)
    const existing = findCard(state.entries, undefined, keyForPhrase)
    if (existing) {
      state = {
        ...state,
        entries: reorderOrInsertCard(
          state.entries,
          undefined,
          keyForPhrase,
          () => existing
        ),
      }
      if (existing.contextStatus === 'error' && !isCardLoading(existing)) {
        const retried = retryCard(state, undefined, existing, event.sentence, now)
        state = retried.state
        plan.push(...retried.plan)
      }
    } else {
      const alloc = allocateToken(state)
      state = {
        ...alloc.state,
        entries: reorderOrInsertCard(
          alloc.state.entries,
          undefined,
          keyForPhrase,
          () => ({
            word: event.phrase!,
            key: keyForPhrase,
            token: alloc.token,
            startedAt: now,
            dictionaryStatus: 'none',
            contextStatus: 'loading',
            contextSentence: event.sentence,
          })
        ),
      }
      plan.push({
        type: 'fetchContextTranslation',
        word: event.phrase,
        sentence: event.sentence,
        sentenceId: undefined,
        key: keyForPhrase,
        token: alloc.token,
      })
    }
  } else {
    const id = sentenceCardId(event.sentence)
    const anchorWord = event.word?.trim() || ''
    const clickedWord = anchorWord.toLowerCase()
    const anchorKey = wordCardKey(clickedWord)
    const existing = findSentence(state.entries, id)
    const nestedAnchor = clickedWord
      ? existing?.words.find(w => w.key === anchorKey)
      : undefined
    const pageCard = clickedWord
      ? adjacentPageCard(state.entries, clickedWord)
      : undefined
    const absorbed = nestedAnchor ? undefined : pageCard

    let sentenceToken: number | undefined
    if (!existing || existing.status === 'error') {
      const alloc = allocateToken(state)
      state = alloc.state
      sentenceToken = alloc.token
    }

    let absorbedCard: WordCardData | undefined
    if (absorbed) {
      const alloc = allocateToken(state)
      state = alloc.state
      absorbedCard = {
        word: absorbed.word,
        key: absorbed.key,
        token: alloc.token,
        startedAt: now,
        pronunciation: absorbed.pronunciation,
        loadCount: absorbed.loadCount,
        dictionaryChinese: absorbed.dictionaryChinese,
        dictionaryStatus: absorbed.dictionaryStatus,
        contextStatus: 'loading',
      }
    }

    const rest = state.entries.filter(e => e !== pageCard)
    if (!existing) {
      state = {
        ...state,
        entries: [
          {
            kind: 'sentence',
            id,
            token: sentenceToken,
            startedAt: now,
            sentence: event.sentence,
            clickedWord,
            status: 'loading',
            chinese: '',
            errorMessage: '',
            errorHttpStatus: undefined,
            words: absorbedCard ? [absorbedCard] : [],
          },
          ...rest,
        ],
      }
    } else {
      let next = patchSentence(moveSentenceToTop(rest, id), id, {
        ...(clickedWord ? { clickedWord } : {}),
        ...(sentenceToken === undefined
          ? {}
          : {
              token: sentenceToken,
              startedAt: now,
              status: 'loading' as const,
              errorMessage: '',
            }),
      })
      const anchorCard = nestedAnchor ?? absorbedCard
      if (anchorCard) {
        next = reorderOrInsertCard(next, id, anchorKey, () => anchorCard)
      }
      state = { ...state, entries: next }
    }

    if (sentenceToken !== undefined) {
      plan.push({
        type: 'translateSentence',
        sentenceId: id,
        sentence: event.sentence,
        token: sentenceToken,
      })
    }

    if (nestedAnchor) {
      if (isFailedCard(nestedAnchor) && !isCardLoading(nestedAnchor)) {
        const retried = retryCard(state, id, nestedAnchor, event.sentence, now)
        state = retried.state
        plan.push(...retried.plan)
      }
    } else if (absorbedCard?.token !== undefined) {
      plan.push({
        type: 'fetchContextTranslation',
        word: absorbedCard.word,
        sentence: event.sentence,
        sentenceId: id,
        key: absorbedCard.key,
        token: absorbedCard.token,
        dictionaryChinese: absorbedCard.dictionaryChinese,
      })
    } else if (anchorWord) {
      const existingAnchor = findCard(state.entries, id, anchorKey)
      if (!existingAnchor) {
        const alloc = allocateToken(state)
        state = {
          ...alloc.state,
          entries: reorderOrInsertCard(alloc.state.entries, id, anchorKey, () => ({
            word: clickedWord,
            key: anchorKey,
            token: alloc.token,
            startedAt: now,
            dictionaryStatus: 'loading',
            contextStatus: 'loading',
          })),
        }
        plan.push({
          type: 'fetchWordContext',
          word: clickedWord,
          sentence: event.sentence,
          sentenceId: id,
          key: anchorKey,
          token: alloc.token,
          counts: false,
        })
      }
    }
  }

  // New content discards an open Undo window (same as PanelHistorySession.update).
  if (state.entries.length > 0 && state.cleared) {
    state = { ...state, cleared: null }
  }
  return { state, plan }
}

export function createPanelHistoryStore(deps: PanelHistoryStoreDeps) {
  const timeoutMs = deps.requestTimeoutMs ?? PANEL_REQUEST_TIMEOUT_MS

  const read = async (tabId: number): Promise<StoredPanelHistory> => {
    const raw = await deps.storage.get(panelHistoryKey(tabId))
    return expireCleared(raw ?? emptyPanelHistory(), deps.now())
  }

  // One locked read-modify-write. The state the mutator sees is the stored
  // one with an expired Undo stash dropped and timed-out loading cards swept
  // (ADR-090 Decisions 5 and 7). A failed write commits nothing: no plan, the
  // error is logged, and the caller's event stays unclaimed.
  const transact = (
    tabId: number,
    mutator: Mutator
  ): Promise<TransactionOutcome> =>
    deps.requestLock(panelHistoryLockName(tabId), async () => {
      const key = panelHistoryKey(tabId)
      const now = deps.now()
      const base = (await deps.storage.get(key)) ?? emptyPanelHistory()
      let state = expireCleared(base, now)
      const swept = sweepTimedOut(state.entries, now, timeoutMs)
      if (swept !== state.entries) state = { ...state, entries: swept }

      const drafted = mutator(state, now)
      if (drafted.state === state && state === base) {
        return { committed: true, plan: [], state }
      }
      if (!(await deps.tabExists(tabId))) {
        return { committed: false, plan: [], state: base }
      }
      const capped: StoredPanelHistory = {
        ...drafted.state,
        entries: trimToCap(drafted.state.entries),
        cleared: drafted.state.cleared
          ? {
              ...drafted.state.cleared,
              entries: trimToCap(drafted.state.cleared.entries),
            }
          : null,
      }
      try {
        await deps.storage.set(key, capped)
      } catch (error) {
        console.error('panelHistoryStore: failed to write panel history', error)
        return { committed: false, plan: [], state: base }
      }
      return { committed: true, plan: drafted.plan ?? [], state: capped }
    })

  const fromDraft = (draft: Draft) => draft

  return {
    read,
    transact,

    /** Mount / timer sweep: persists timed-out cards as error (Decision 5). */
    sweep: (tabId: number) => transact(tabId, state => ({ state })),

    claimSentenceEvent: (tabId: number, event: SentenceEventInput) =>
      transact(tabId, (state, now) => fromDraft(claimSentence(state, event, now))),

    claimPageWordEvent: (tabId: number, event: PageWordEventInput) =>
      transact(tabId, state => {
        if (state.claimedPageWordEventIds.includes(event.eventId)) {
          return { state }
        }
        const word = event.word.trim().toLowerCase()
        return {
          state: {
            ...state,
            claimedPageWordEventIds: pushClaim(
              state.claimedPageWordEventIds,
              event.eventId
            ),
            entries: upsertPageLookupCard(state.entries, {
              word,
              key: wordCardKey(word),
              pronunciation: event.ecp.Pronunciation,
              loadCount: event.ecp.LoadCount,
              dictionaryChinese: event.ecp.Chinese,
              dictionaryStatus: 'loaded',
              contextStatus: 'none',
            }),
            cleared: null,
          },
        }
      }),

    clear: (tabId: number) =>
      transact(tabId, (state, now) => {
        const generation = state.clearGeneration + 1
        return {
          state: {
            ...state,
            entries: [],
            cleared: {
              generation,
              entries: state.entries,
              expiresAt: now + PANEL_HISTORY_UNDO_MS,
            },
            clearGeneration: generation,
          },
        }
      }),

    undo: (tabId: number) =>
      transact(tabId, state =>
        state.cleared
          ? {
              state: {
                ...state,
                entries: state.cleared.entries,
                cleared: null,
              },
            }
          : { state }
      ),

    /** Drops the Undo stash only if it is generation `generation` and due. */
    discardClearedGeneration: (tabId: number, generation: number) =>
      transact(tabId, (state, now) =>
        state.cleared &&
        state.cleared.generation === generation &&
        state.cleared.expiresAt <= now
          ? { state: { ...state, cleared: null } }
          : { state }
      ),

    removeCard: (
      tabId: number,
      sentenceId: string | undefined,
      cardKey: string
    ) =>
      transact(tabId, state => ({
        state: {
          ...state,
          entries: removeCard(state.entries, sentenceId, cardKey),
        },
      })),

    /** Writes a response back (the update applies the token rule itself). */
    patchEntries: (
      tabId: number,
      update: (entries: PanelEntry[]) => PanelEntry[]
    ) =>
      transact(tabId, state => ({
        state: {
          ...state,
          entries: update(state.entries),
          cleared: state.cleared
            ? { ...state.cleared, entries: update(state.cleared.entries) }
            : null,
        },
      })),

    /**
     * Retry of a sentence card (and the failed words nested in it, whose
     * failure the sentence's error row shares). No plan when the card is gone
     * or already loading.
     */
    retrySentence: (tabId: number, sentenceId: string) =>
      transact(tabId, (start, now) => {
        const entry = findSentence(start.entries, sentenceId)
        if (!entry || entry.status === 'loading') return { state: start }
        const alloc = allocateToken(start)
        let state: StoredPanelHistory = {
          ...alloc.state,
          entries: patchSentence(alloc.state.entries, sentenceId, {
            token: alloc.token,
            startedAt: now,
            status: 'loading',
            errorMessage: '',
            errorHttpStatus: undefined,
            sessionExpired: false,
            sessionUnverified: false,
          }),
        }
        const plan: PlannedRequest[] = [
          {
            type: 'translateSentence',
            sentenceId: entry.id,
            sentence: entry.sentence,
            token: alloc.token,
          },
        ]
        for (const card of entry.words) {
          if (isFailedCard(card) && !isCardLoading(card)) {
            const retried = retryCard(state, entry.id, card, entry.sentence, now)
            state = retried.state
            plan.push(...retried.plan)
          }
        }
        return { state, plan }
      }),

    /** Retry of a word/phrase card's context half (or its whole chain). */
    retryContext: (
      tabId: number,
      sentenceId: string | undefined,
      key: string
    ) =>
      transact(tabId, (state, now) => {
        const card = findCard(state.entries, sentenceId, key)
        const sentence = sentenceId
          ? findSentence(state.entries, sentenceId)?.sentence
          : card?.contextSentence
        if (!card || !sentence || isCardLoading(card)) return { state }
        return fromDraft(retryCard(state, sentenceId, card, sentence, now))
      }),

    /** Retry of the dictionary half alone (#686); a loading context half keeps its token. */
    retryDictionary: (
      tabId: number,
      sentenceId: string | undefined,
      key: string
    ) =>
      transact(tabId, (start, now) => {
        const card = findCard(start.entries, sentenceId, key)
        if (!card || card.dictionaryStatus === 'loading') return { state: start }
        const keepToken =
          card.contextStatus === 'loading' && card.token !== undefined
        const alloc = keepToken
          ? { state: start, token: card.token! }
          : allocateToken(start)
        return {
          state: {
            ...alloc.state,
            entries: patchCard(alloc.state.entries, sentenceId, key, {
              token: alloc.token,
              startedAt: keepToken ? (card.startedAt ?? now) : now,
              dictionaryStatus: 'loading',
              dictionaryError: undefined,
              dictionaryErrorHttpStatus: undefined,
              dictionaryErrorCode: undefined,
              dictionarySessionExpired: false,
              dictionarySessionUnverified: false,
            }),
          },
          plan: [
            {
              type: 'fetchDictionary',
              word: card.word,
              sentenceId,
              key,
              token: alloc.token,
            },
          ],
        }
      }),

    /**
     * A phrase selected in a sentence (nested) or on the page (top-level).
     * An existing card moves up; one that failed is retried; one still
     * loading is left alone.
     */
    upsertPhrase: (
      tabId: number,
      phrase: string,
      sentence: string,
      sentenceId: string | undefined
    ) =>
      transact(tabId, (start, now) => {
        const key =
          sentenceId === undefined
            ? topLevelPhraseCardKey(phrase, sentence)
            : wordCardKey(phrase)
        const existing = findCard(start.entries, sentenceId, key)
        if (existing) {
          const moved: StoredPanelHistory = {
            ...start,
            entries: reorderOrInsertCard(
              start.entries,
              sentenceId,
              key,
              () => existing
            ),
          }
          if (existing.contextStatus === 'error' && !isCardLoading(existing)) {
            return fromDraft(retryCard(moved, sentenceId, existing, sentence, now))
          }
          return { state: moved }
        }
        const alloc = allocateToken(start)
        return {
          state: {
            ...alloc.state,
            entries: reorderOrInsertCard(
              alloc.state.entries,
              sentenceId,
              key,
              () => ({
                word: phrase,
                key,
                token: alloc.token,
                startedAt: now,
                dictionaryStatus: 'none',
                contextStatus: 'loading',
                contextSentence: sentenceId === undefined ? sentence : undefined,
              })
            ),
          },
          plan: [
            {
              type: 'fetchContextTranslation',
              word: phrase,
              sentence,
              sentenceId,
              key,
              token: alloc.token,
            },
          ],
        }
      }),

    /** A word clicked in a sentence's own original (ADR-017). */
    clickWord: (
      tabId: number,
      rawWord: string,
      sentence: string,
      sentenceId: string
    ) =>
      transact(tabId, (start, now) => {
        const word = rawWord.toLowerCase()
        const key = wordCardKey(word)
        const existing = findCard(start.entries, sentenceId, key)
        if (existing) {
          return {
            state: {
              ...start,
              entries: reorderOrInsertCard(
                start.entries,
                sentenceId,
                key,
                () => existing
              ),
            },
          }
        }
        const alloc = allocateToken(start)
        return {
          state: {
            ...alloc.state,
            entries: reorderOrInsertCard(
              alloc.state.entries,
              sentenceId,
              key,
              () => ({
                word,
                key,
                token: alloc.token,
                startedAt: now,
                dictionaryStatus: 'loading',
                contextStatus: 'loading',
              })
            ),
          },
          plan: [
            {
              type: 'fetchWordContext',
              word,
              sentence,
              sentenceId,
              key,
              token: alloc.token,
              counts: true,
            },
          ],
        }
      }),

    /**
     * The context half of a dictionary-then-context chain is about to be
     * sent: re-record its startedAt. False (do not send) when the card is
     * gone, timed out or carries another token.
     */
    markContextSent: async (
      tabId: number,
      sentenceId: string | undefined,
      key: string,
      token: number
    ): Promise<boolean> => {
      const outcome = await transact(tabId, (state, now) => {
        const card = findCard(state.entries, sentenceId, key)
        if (!card || card.token !== token) return { state }
        return {
          state: {
            ...state,
            entries: patchCard(
              state.entries,
              sentenceId,
              key,
              { startedAt: now },
              token
            ),
          },
        }
      })
      return (
        outcome.committed &&
        findCard(outcome.state.entries, sentenceId, key)?.token === token
      )
    },

    async removeForTab(tabId: number): Promise<void> {
      await deps.requestLock(panelHistoryLockName(tabId), async () => {
        await deps.storage.remove(panelHistoryKey(tabId))
      })
    },
  }
}

export type PanelHistoryStore = ReturnType<typeof createPanelHistoryStore>

/** Chrome-backed deps for the Side Panel and background. */
export function chromePanelHistoryDeps(
  overrides: Partial<PanelHistoryStoreDeps> = {}
): PanelHistoryStoreDeps {
  return {
    storage: {
      get: async key => {
        const result = await chrome.storage.session.get(key)
        return result[key] as StoredPanelHistory | undefined
      },
      set: async (key, value) => {
        await chrome.storage.session.set({ [key]: value })
      },
      remove: async key => {
        await chrome.storage.session.remove(key)
      },
    },
    requestLock: (name, callback) => navigator.locks.request(name, callback),
    tabExists: async tabId => {
      try {
        await chrome.tabs.get(tabId)
        return true
      } catch {
        return false
      }
    },
    now: () => Date.now(),
    ...overrides,
  }
}
