// ADR-090: the Side Panel's card list lives in chrome.storage.session, one
// copy per reading tab, shared by every panel document of that tab. Every
// write is a locked read-modify-write that returns the committed request
// plan (or none). I/O enters through the constructor.

import {
  adjacentPageCard,
  findCard,
  findSentence,
  moveSentenceToTop,
  patchCard,
  patchSentence,
  removeCard,
  reorderOrInsertCard,
  sentenceCardId,
  topLevelPhraseCardKey,
  upsertPageLookupCard,
  wordCardKey,
  type PanelEntry,
  type SentenceEntry,
  type WordCardData,
} from './panelHistory'

export const PANEL_HISTORY_KEY_PREFIX = 'enx-panel-history'
export const PANEL_HISTORY_MAX_ENTRIES = 100
export const PANEL_HISTORY_MAX_CLAIMS = 20
export const PANEL_HISTORY_UNDO_MS = 5000
export const PANEL_ORPHAN_ERROR_MESSAGE =
  'Request interrupted. Tap Retry to try again.'

export const panelHistoryKey = (tabId: number): string =>
  `${PANEL_HISTORY_KEY_PREFIX}:${tabId}`

export const panelHistoryLockName = (tabId: number): string =>
  panelHistoryKey(tabId)

export const panelAliveLockName = (instanceId: string): string =>
  `enx-panel-alive:${instanceId}`

export type ClaimStream = 'sentence' | 'pageWord'

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
      ownerInstanceId: string
    }
  | {
      type: 'fetchWordContext'
      word: string
      sentence: string
      sentenceId: string | undefined
      key: string
      token: number
      ownerInstanceId: string
      counts: boolean
    }
  | {
      type: 'fetchContextTranslation'
      word: string
      sentence: string
      sentenceId: string | undefined
      key: string
      token: number
      ownerInstanceId: string
      dictionaryChinese?: string
    }

export type TransactionOutcome = {
  /** False when the tab is gone, or both the write and its quota retry failed. */
  committed: boolean
  plan: PlannedRequest[]
  state: StoredPanelHistory
}

export type PendingError = {
  sentenceId: string | undefined
  /** Sentence cards use the sentence id; word/phrase cards use their key. */
  key: string
  kind: 'sentence' | 'word'
  sentencePatch?: Partial<SentenceEntry>
  wordPatch?: Partial<WordCardData>
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
}

type Mutator = (
  state: StoredPanelHistory
) => {
  state: StoredPanelHistory
  plan?: PlannedRequest[]
  /** When true, skip the write (read-only / already claimed). */
  skipWrite?: boolean
}

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

const trimOldestHalf = (entries: PanelEntry[]): PanelEntry[] =>
  entries.slice(0, Math.ceil(entries.length / 2))

const isQuotaError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false
  const message = String((error as { message?: string }).message ?? error)
  return /quota|QUOTA|exceed/i.test(message)
}

const markOrphanLoading = (
  entries: PanelEntry[],
  ownerInstanceId: string
): PanelEntry[] =>
  entries.map(entry => {
    if (entry.kind === 'sentence') {
      let next: SentenceEntry = entry
      if (
        entry.status === 'loading' &&
        entry.ownerInstanceId === ownerInstanceId
      ) {
        next = {
          ...entry,
          status: 'error',
          errorMessage: PANEL_ORPHAN_ERROR_MESSAGE,
          token: undefined,
          ownerInstanceId: undefined,
        }
      }
      const words = next.words.map(card => {
        const loading =
          card.dictionaryStatus === 'loading' ||
          card.contextStatus === 'loading'
        if (!loading || card.ownerInstanceId !== ownerInstanceId) return card
        return {
          ...card,
          ...(card.dictionaryStatus === 'loading'
            ? {
                dictionaryStatus: 'error' as const,
                dictionaryError: PANEL_ORPHAN_ERROR_MESSAGE,
              }
            : {}),
          ...(card.contextStatus === 'loading'
            ? {
                contextStatus: 'error' as const,
                contextError: PANEL_ORPHAN_ERROR_MESSAGE,
              }
            : {}),
          token: undefined,
          ownerInstanceId: undefined,
        }
      })
      return words === next.words ? next : { ...next, words }
    }
    const loading =
      entry.dictionaryStatus === 'loading' || entry.contextStatus === 'loading'
    if (!loading || entry.ownerInstanceId !== ownerInstanceId) return entry
    return {
      ...entry,
      ...(entry.dictionaryStatus === 'loading'
        ? {
            dictionaryStatus: 'error' as const,
            dictionaryError: PANEL_ORPHAN_ERROR_MESSAGE,
          }
        : {}),
      ...(entry.contextStatus === 'loading'
        ? {
            contextStatus: 'error' as const,
            contextError: PANEL_ORPHAN_ERROR_MESSAGE,
          }
        : {}),
      token: undefined,
      ownerInstanceId: undefined,
    }
  })

const applyPendingErrors = (
  state: StoredPanelHistory,
  pending: PendingError[]
): { state: StoredPanelHistory; remaining: PendingError[] } => {
  let next = state
  const remaining: PendingError[] = []
  for (const error of pending) {
    if (error.kind === 'sentence' && error.sentencePatch) {
      const before = next.entries
      next = {
        ...next,
        entries: patchSentence(next.entries, error.key, error.sentencePatch),
      }
      if (next.entries === before) remaining.push(error)
    } else if (error.kind === 'word' && error.wordPatch) {
      const before = next.entries
      next = {
        ...next,
        entries: patchCard(
          next.entries,
          error.sentenceId,
          error.key,
          error.wordPatch
        ),
      }
      if (next.entries === before) remaining.push(error)
    } else {
      remaining.push(error)
    }
  }
  return { state: next, remaining }
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

export function createPanelHistoryStore(deps: PanelHistoryStoreDeps) {
  const readFresh = async (tabId: number): Promise<StoredPanelHistory> => {
    const raw = await deps.storage.get(panelHistoryKey(tabId))
    return expireCleared(raw ?? emptyPanelHistory(), deps.now())
  }

  const writeWithQuotaRetry = async (
    key: string,
    state: StoredPanelHistory
  ): Promise<StoredPanelHistory | null> => {
    const capped: StoredPanelHistory = {
      ...state,
      entries: trimToCap(state.entries),
      cleared: state.cleared
        ? {
            ...state.cleared,
            entries: trimToCap(state.cleared.entries),
          }
        : null,
    }
    try {
      await deps.storage.set(key, capped)
      return capped
    } catch (error) {
      if (!isQuotaError(error)) throw error
      const trimmed: StoredPanelHistory = {
        ...capped,
        entries: trimOldestHalf(capped.entries),
        cleared: capped.cleared
          ? {
              ...capped.cleared,
              entries: trimOldestHalf(capped.cleared.entries),
            }
          : null,
      }
      try {
        await deps.storage.set(key, trimmed)
        return trimmed
      } catch (retryError) {
        if (!isQuotaError(retryError)) throw retryError
        return null
      }
    }
  }

  const transact = async (
    tabId: number,
    mutator: Mutator
  ): Promise<TransactionOutcome> => {
    const key = panelHistoryKey(tabId)
    return deps.requestLock(panelHistoryLockName(tabId), async () => {
      const before = await readFresh(tabId)
      const { state: drafted, plan = [], skipWrite } = mutator(before)
      if (skipWrite) {
        return { committed: true, plan: [], state: before }
      }
      const exists = await deps.tabExists(tabId)
      if (!exists) {
        return { committed: false, plan: [], state: before }
      }
      const written = await writeWithQuotaRetry(key, {
        ...drafted,
        entries: trimToCap(drafted.entries),
      })
      if (!written) {
        return { committed: false, plan: [], state: before }
      }
      return { committed: true, plan, state: written }
    })
  }

  const claimSentenceEvent = (
    tabId: number,
    instanceId: string,
    event: SentenceEventInput,
    pendingErrors: PendingError[] = []
  ): Promise<TransactionOutcome & { remainingPending: PendingError[] }> =>
    deps.requestLock(panelHistoryLockName(tabId), async () => {
      const key = panelHistoryKey(tabId)
      let state = await readFresh(tabId)
      const flushed = applyPendingErrors(state, pendingErrors)
      state = flushed.state
      let remainingPending = flushed.remaining

      if (state.claimedSentenceEventIds.includes(event.eventId)) {
        if (state !== (await readFresh(tabId)) || pendingErrors.length > 0) {
          const exists = await deps.tabExists(tabId)
          if (exists) {
            const written = await writeWithQuotaRetry(key, state)
            if (written) {
              return {
                committed: true,
                plan: [],
                state: written,
                remainingPending,
              }
            }
          }
        }
        return {
          committed: true,
          plan: [],
          state,
          remainingPending: pendingErrors,
        }
      }

      state = {
        ...state,
        claimedSentenceEventIds: pushClaim(
          state.claimedSentenceEventIds,
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
          if (existing.contextStatus === 'error') {
            const alloc = allocateToken(state)
            state = alloc.state
            state = {
              ...state,
              entries: patchCard(state.entries, undefined, keyForPhrase, {
                token: alloc.token,
                ownerInstanceId: instanceId,
                contextStatus: 'loading',
                contextError: undefined,
              }),
            }
            plan.push({
              type: 'fetchContextTranslation',
              word: event.phrase,
              sentence: event.sentence,
              sentenceId: undefined,
              key: keyForPhrase,
              token: alloc.token,
              ownerInstanceId: instanceId,
            })
          }
        } else {
          const alloc = allocateToken(state)
          state = alloc.state
          state = {
            ...state,
            entries: reorderOrInsertCard(
              state.entries,
              undefined,
              keyForPhrase,
              () => ({
                word: event.phrase!,
                key: keyForPhrase,
                token: alloc.token,
                ownerInstanceId: instanceId,
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
            ownerInstanceId: instanceId,
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
            ownerInstanceId: instanceId,
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
                ownerInstanceId: instanceId,
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
                  ownerInstanceId: instanceId,
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
            ownerInstanceId: instanceId,
          })
        }

        if (nestedAnchor) {
          if (
            nestedAnchor.contextStatus === 'error' ||
            nestedAnchor.dictionaryStatus === 'error'
          ) {
            const alloc = allocateToken(state)
            state = alloc.state
            const contextOnly =
              nestedAnchor.dictionaryStatus === 'none' ||
              nestedAnchor.dictionaryStatus === 'loaded'
            state = {
              ...state,
              entries: patchCard(state.entries, id, nestedAnchor.key, {
                token: alloc.token,
                ownerInstanceId: instanceId,
                contextStatus: 'loading',
                contextError: undefined,
                ...(contextOnly
                  ? {}
                  : {
                      dictionaryStatus: 'loading' as const,
                      dictionaryError: undefined,
                    }),
              }),
            }
            if (contextOnly) {
              plan.push({
                type: 'fetchContextTranslation',
                word: nestedAnchor.word,
                sentence: event.sentence,
                sentenceId: id,
                key: nestedAnchor.key,
                token: alloc.token,
                ownerInstanceId: instanceId,
                dictionaryChinese:
                  nestedAnchor.dictionaryStatus === 'loaded'
                    ? nestedAnchor.dictionaryChinese
                    : undefined,
              })
            } else {
              plan.push({
                type: 'fetchWordContext',
                word: nestedAnchor.word,
                sentence: event.sentence,
                sentenceId: id,
                key: nestedAnchor.key,
                token: alloc.token,
                ownerInstanceId: instanceId,
                counts: false,
              })
            }
          }
        } else if (absorbedCard?.token !== undefined) {
          plan.push({
            type: 'fetchContextTranslation',
            word: absorbedCard.word,
            sentence: event.sentence,
            sentenceId: id,
            key: absorbedCard.key,
            token: absorbedCard.token,
            ownerInstanceId: instanceId,
            dictionaryChinese: absorbedCard.dictionaryChinese,
          })
        } else if (anchorWord) {
          const existingAnchor = findCard(state.entries, id, anchorKey)
          if (!existingAnchor) {
            const alloc = allocateToken(state)
            state = alloc.state
            state = {
              ...state,
              entries: reorderOrInsertCard(state.entries, id, anchorKey, () => ({
                word: clickedWord,
                key: anchorKey,
                token: alloc.token,
                ownerInstanceId: instanceId,
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
              ownerInstanceId: instanceId,
              counts: false,
            })
          }
        }
      }

      // New content discards an open Undo window (same as PanelHistorySession.update).
      if (state.entries.length > 0 && state.cleared) {
        state = { ...state, cleared: null }
      }

      const exists = await deps.tabExists(tabId)
      if (!exists) {
        return {
          committed: false,
          plan: [],
          state: await readFresh(tabId),
          remainingPending: pendingErrors,
        }
      }
      const written = await writeWithQuotaRetry(key, state)
      if (!written) {
        return {
          committed: false,
          plan: [],
          state: await readFresh(tabId),
          remainingPending: pendingErrors,
        }
      }
      return {
        committed: true,
        plan,
        state: written,
        remainingPending,
      }
    })

  const claimPageWordEvent = (
    tabId: number,
    _instanceId: string,
    event: PageWordEventInput,
    pendingErrors: PendingError[] = []
  ): Promise<TransactionOutcome & { remainingPending: PendingError[] }> =>
    deps.requestLock(panelHistoryLockName(tabId), async () => {
      const key = panelHistoryKey(tabId)
      let state = await readFresh(tabId)
      const flushed = applyPendingErrors(state, pendingErrors)
      state = flushed.state
      const remainingPending = flushed.remaining

      if (state.claimedPageWordEventIds.includes(event.eventId)) {
        if (pendingErrors.length > 0) {
          const exists = await deps.tabExists(tabId)
          if (exists) {
            const written = await writeWithQuotaRetry(key, state)
            if (written) {
              return {
                committed: true,
                plan: [],
                state: written,
                remainingPending,
              }
            }
          }
        }
        return {
          committed: true,
          plan: [],
          state,
          remainingPending: pendingErrors,
        }
      }

      const word = event.word.trim().toLowerCase()
      state = {
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
      }

      const exists = await deps.tabExists(tabId)
      if (!exists) {
        return {
          committed: false,
          plan: [],
          state: await readFresh(tabId),
          remainingPending: pendingErrors,
        }
      }
      const written = await writeWithQuotaRetry(key, state)
      if (!written) {
        return {
          committed: false,
          plan: [],
          state: await readFresh(tabId),
          remainingPending: pendingErrors,
        }
      }
      return { committed: true, plan: [], state: written, remainingPending }
    })

  return {
    read: readFresh,

    transact,

    claimSentenceEvent,
    claimPageWordEvent,

    async clear(
      tabId: number,
      pendingErrors: PendingError[] = []
    ): Promise<TransactionOutcome & { remainingPending: PendingError[] }> {
      return deps.requestLock(panelHistoryLockName(tabId), async () => {
        const key = panelHistoryKey(tabId)
        let state = await readFresh(tabId)
        const flushed = applyPendingErrors(state, pendingErrors)
        state = flushed.state
        const generation = state.clearGeneration + 1
        const next: StoredPanelHistory = {
          ...state,
          entries: [],
          cleared: {
            generation,
            entries: state.entries,
            expiresAt: deps.now() + PANEL_HISTORY_UNDO_MS,
          },
          clearGeneration: generation,
        }
        const exists = await deps.tabExists(tabId)
        if (!exists) {
          return {
            committed: false,
            plan: [],
            state,
            remainingPending: pendingErrors,
          }
        }
        const written = await writeWithQuotaRetry(key, next)
        if (!written) {
          return {
            committed: false,
            plan: [],
            state,
            remainingPending: pendingErrors,
          }
        }
        return {
          committed: true,
          plan: [],
          state: written,
          remainingPending: flushed.remaining,
        }
      })
    },

    async undo(
      tabId: number,
      pendingErrors: PendingError[] = []
    ): Promise<TransactionOutcome & { remainingPending: PendingError[] }> {
      return deps.requestLock(panelHistoryLockName(tabId), async () => {
        const key = panelHistoryKey(tabId)
        let state = await readFresh(tabId)
        const flushed = applyPendingErrors(state, pendingErrors)
        state = flushed.state
        if (!state.cleared) {
          return {
            committed: true,
            plan: [],
            state,
            remainingPending: pendingErrors,
          }
        }
        const next: StoredPanelHistory = {
          ...state,
          entries: state.cleared.entries,
          cleared: null,
        }
        const exists = await deps.tabExists(tabId)
        if (!exists) {
          return {
            committed: false,
            plan: [],
            state,
            remainingPending: pendingErrors,
          }
        }
        const written = await writeWithQuotaRetry(key, next)
        if (!written) {
          return {
            committed: false,
            plan: [],
            state,
            remainingPending: pendingErrors,
          }
        }
        return {
          committed: true,
          plan: [],
          state: written,
          remainingPending: flushed.remaining,
        }
      })
    },

    async discardClearedGeneration(
      tabId: number,
      generation: number
    ): Promise<TransactionOutcome> {
      return transact(tabId, state => {
        if (!state.cleared || state.cleared.generation !== generation) {
          return { state, skipWrite: true }
        }
        if (state.cleared.expiresAt > deps.now()) {
          return { state, skipWrite: true }
        }
        return { state: { ...state, cleared: null } }
      })
    },

    async removeCard(
      tabId: number,
      sentenceId: string | undefined,
      cardKey: string,
      pendingErrors: PendingError[] = []
    ): Promise<TransactionOutcome & { remainingPending: PendingError[] }> {
      return deps.requestLock(panelHistoryLockName(tabId), async () => {
        const key = panelHistoryKey(tabId)
        let state = await readFresh(tabId)
        const flushed = applyPendingErrors(state, pendingErrors)
        state = flushed.state
        const next = {
          ...state,
          entries: removeCard(state.entries, sentenceId, cardKey),
        }
        const exists = await deps.tabExists(tabId)
        if (!exists) {
          return {
            committed: false,
            plan: [],
            state,
            remainingPending: pendingErrors,
          }
        }
        const written = await writeWithQuotaRetry(key, next)
        if (!written) {
          return {
            committed: false,
            plan: [],
            state,
            remainingPending: pendingErrors,
          }
        }
        return {
          committed: true,
          plan: [],
          state: written,
          remainingPending: flushed.remaining,
        }
      })
    },

    async patchEntries(
      tabId: number,
      update: (entries: PanelEntry[]) => PanelEntry[],
      pendingErrors: PendingError[] = []
    ): Promise<TransactionOutcome & { remainingPending: PendingError[] }> {
      return deps.requestLock(panelHistoryLockName(tabId), async () => {
        const key = panelHistoryKey(tabId)
        let state = await readFresh(tabId)
        const flushed = applyPendingErrors(state, pendingErrors)
        state = flushed.state
        const next: StoredPanelHistory = {
          ...state,
          entries: update(state.entries),
          cleared: state.cleared
            ? { ...state.cleared, entries: update(state.cleared.entries) }
            : null,
        }
        const exists = await deps.tabExists(tabId)
        if (!exists) {
          return {
            committed: false,
            plan: [],
            state,
            remainingPending: pendingErrors,
          }
        }
        const written = await writeWithQuotaRetry(key, next)
        if (!written) {
          return {
            committed: false,
            plan: [],
            state,
            remainingPending: pendingErrors,
          }
        }
        return {
          committed: true,
          plan: [],
          state: written,
          remainingPending: flushed.remaining,
        }
      })
    },

    async orphanOwner(
      tabId: number,
      ownerInstanceId: string
    ): Promise<TransactionOutcome> {
      return transact(tabId, state => ({
        state: {
          ...state,
          entries: markOrphanLoading(state.entries, ownerInstanceId),
          cleared: state.cleared
            ? {
                ...state.cleared,
                entries: markOrphanLoading(
                  state.cleared.entries,
                  ownerInstanceId
                ),
              }
            : null,
        },
      }))
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
