// ADR-090: the Side Panel's card list lives in chrome.storage.session, one
// copy per reading tab, shared by every panel document of that tab. Every
// write is a locked read-modify-write that returns the committed request
// plan (or none): allocation of tokens, retry decisions and card transitions
// all happen here, on the state read under the lock. I/O enters through the
// constructor.

import {
  PANEL_REQUEST_TIMEOUT_MS,
  absorbablePageCards,
  cardDefinition,
  cardId,
  findCard,
  findCardByToken,
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
  wordCardId,
  wordCardKey,
  type PanelEntry,
  type WordCardData,
} from './panelHistory'
import type { ExplanationLanguage } from './assumedExplanationLanguage'

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

export type CombinedWordRequest = {
  key: string
  word: string
  token: number
  dictionaryChinese: string
}

export type PlannedRequest =
  | {
      type: 'translateSentence'
      sentenceId: string
      sentence: string
      token: number
    }
  | {
      // One AI call for the sentence and the word cards it absorbed
      // (ADR-023 Decision 9); each carries its own token.
      type: 'translateSentenceWithWords'
      sentenceId: string
      sentence: string
      token: number
      words: CombinedWordRequest[]
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
  /** Start a continuation after the write, while the history lock is held. */
  afterWrite?: () => void
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
  const entries = patchCard(alloc.state.entries, sentenceId, cardId(card), {
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
          card.dictionaryStatus === 'loaded'
            ? card.dictionaryChinese
            : undefined,
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

const combinedWord = (
  card: WordCardData,
  token: number
): CombinedWordRequest => ({
  key: card.key,
  word: card.word,
  token,
  dictionaryChinese: card.dictionaryChinese ?? '',
})

// An absorbed card whose context failed with its dictionary half loaded goes
// back into the sentence's combined request (Retry, errored resend).
const isRetryableAbsorbed = (card: WordCardData): boolean =>
  card.absorbed === true &&
  card.contextStatus === 'error' &&
  card.dictionaryStatus === 'loaded' &&
  !isCardLoading(card)

// Gives each card a new token and puts its context back to loading.
const restartAbsorbed = (
  start: StoredPanelHistory,
  sentenceId: string,
  cards: WordCardData[],
  now: number
): { state: StoredPanelHistory; words: CombinedWordRequest[] } => {
  let state = start
  const words: CombinedWordRequest[] = []
  for (const card of cards) {
    const alloc = allocateToken(state)
    state = {
      ...alloc.state,
      entries: patchCard(alloc.state.entries, sentenceId, cardId(card), {
        token: alloc.token,
        startedAt: now,
        contextStatus: 'loading',
        contextError: undefined,
        contextErrorHttpStatus: undefined,
        contextSessionExpired: false,
        contextSessionUnverified: false,
      }),
    }
    words.push(combinedWord(card, alloc.token))
  }
  return { state, words }
}

export type SentenceEventInput = {
  eventId: string
  sentence: string
  word: string
  phrase?: string
  wordStates?: Record<string, import('@/types').WordData>
  // The background's assumed language when the sentence arrived (ADR-098).
  explanationLanguage?: ExplanationLanguage
}

export type PageWordEventInput = {
  eventId: string
  word: string
  ecp: import('@/types').WordData
  // The popover re-read after an explanation-language switch, not a lookup.
  reread?: boolean
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
        const retried = retryCard(
          state,
          undefined,
          existing,
          event.sentence,
          now
        )
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
    const language = event.explanationLanguage ?? 'zh-Hans'
    const anchorId = wordCardId(anchorKey, language)
    const needsSentence =
      !findSentence(state.entries, id) ||
      findSentence(state.entries, id)!.status === 'error'

    // An errored resend puts the failed absorbed words back into the one
    // combined request, next to the newly absorbed ones.
    const restarted: CombinedWordRequest[] = []
    const errored = findSentence(state.entries, id)
    if (errored && needsSentence) {
      const again = restartAbsorbed(
        state,
        id,
        errored.words.filter(isRetryableAbsorbed),
        now
      )
      state = again.state
      restarted.push(...again.words)
    }
    const existing = findSentence(state.entries, id)
    const nestedIds = new Set(existing?.words.map(cardId))
    const nestedAnchor = clickedWord
      ? existing?.words.find(w => cardId(w) === anchorId)
      : undefined

    // The window above the first sentence card: matching cards leave the top
    // level; one the sentence already holds is dropped without copying data.
    const reach = absorbablePageCards(state.entries, event.sentence, language)
    const leaving = new Set<PanelEntry>(reach)
    const absorbedCards: WordCardData[] = []
    for (const card of reach) {
      if (nestedIds.has(cardId(card))) continue
      const alloc = allocateToken(state)
      state = alloc.state
      absorbedCards.push({
        word: card.word,
        key: card.key,
        token: alloc.token,
        startedAt: now,
        pronunciation: card.pronunciation,
        loadCount: card.loadCount,
        dictionaryChinese: card.dictionaryChinese,
        explanationLanguage: card.explanationLanguage,
        senses: card.senses,
        lemmaNote: card.lemmaNote,
        pronunciationUS: card.pronunciationUS,
        pronunciationUK: card.pronunciationUK,
        dictionaryStatus: card.dictionaryStatus,
        contextStatus: 'loading',
        absorbed: true,
      })
    }

    let sentenceToken: number | undefined
    if (needsSentence) {
      const alloc = allocateToken(state)
      state = alloc.state
      sentenceToken = alloc.token
    }

    // Anchor first, then the absorbed cards in their prior top-level order,
    // then whatever the sentence already held.
    const words = [...absorbedCards, ...(existing?.words ?? [])]
    const anchorAt = clickedWord
      ? words.findIndex(w => cardId(w) === anchorId)
      : -1
    const ordered =
      anchorAt > 0
        ? [
            words[anchorAt],
            ...words.slice(0, anchorAt),
            ...words.slice(anchorAt + 1),
          ]
        : words

    const rest = state.entries.filter(e => !leaving.has(e))
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
            words: ordered,
          },
          ...rest,
        ],
      }
    } else {
      state = {
        ...state,
        entries: patchSentence(moveSentenceToTop(rest, id), id, {
          ...(clickedWord ? { clickedWord } : {}),
          ...(sentenceToken === undefined
            ? {}
            : {
                token: sentenceToken,
                startedAt: now,
                status: 'loading' as const,
                errorMessage: '',
              }),
          words: ordered,
        }),
      }
    }

    // By token: the sentence may hold one word in both languages.
    const participants = new Set([
      ...restarted.map(w => w.token),
      ...absorbedCards.map(w => w.token),
    ])
    if (sentenceToken !== undefined) {
      const combined = ordered
        .filter(w => participants.has(w.token))
        .map(w => combinedWord(w, w.token!))
      plan.push(
        combined.length === 0
          ? {
              type: 'translateSentence',
              sentenceId: id,
              sentence: event.sentence,
              token: sentenceToken,
            }
          : {
              type: 'translateSentenceWithWords',
              sentenceId: id,
              sentence: event.sentence,
              token: sentenceToken,
              words: combined,
            }
      )
    } else {
      // The sentence's own request is left alone: each newly absorbed word
      // asks for its context on its own.
      for (const card of absorbedCards) {
        plan.push({
          type: 'fetchContextTranslation',
          word: card.word,
          sentence: event.sentence,
          sentenceId: id,
          key: card.key,
          token: card.token!,
          dictionaryChinese: card.dictionaryChinese,
        })
      }
    }

    if (nestedAnchor) {
      if (
        isFailedCard(nestedAnchor) &&
        !isCardLoading(nestedAnchor) &&
        !participants.has(nestedAnchor.token)
      ) {
        const retried = retryCard(state, id, nestedAnchor, event.sentence, now)
        state = retried.state
        plan.push(...retried.plan)
      }
    } else if (absorbedCards.some(c => cardId(c) === anchorId)) {
      // Already planned above.
    } else if (anchorWord) {
      const existingAnchor = findCard(state.entries, id, anchorId)
      if (!existingAnchor) {
        const alloc = allocateToken(state)
        state = {
          ...alloc.state,
          entries: reorderOrInsertCard(
            alloc.state.entries,
            id,
            anchorId,
            () => ({
              word: clickedWord,
              key: anchorKey,
              explanationLanguage: language,
              token: alloc.token,
              startedAt: now,
              dictionaryStatus: 'loading',
              contextStatus: 'loading',
            })
          ),
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

export type CombinedPlan = Extract<
  PlannedRequest,
  { type: 'translateSentenceWithWords' }
>

export type CombinedResponse =
  | {
      success: true
      chinese: string
      words: { word: string; chinese: string; why: string }[]
    }
  | {
      success: false
      error?: string
      status?: number
      sessionExpired?: boolean
      sessionUnverified?: boolean
    }

type FallbackRequest = Extract<
  PlannedRequest,
  { type: 'fetchContextTranslation' }
>

// Writes one combined result into `entries`. The sentence and every word
// check their own token, so a stale sentence never blocks a current word.
// A word the response left without a gloss is returned as an individual
// request carrying its existing token (`refresh` re-records its startedAt).
const applyCombined = (
  start: PanelEntry[],
  plan: CombinedPlan,
  response: CombinedResponse,
  now: number,
  refresh: boolean
): { entries: PanelEntry[]; fallbacks: FallbackRequest[] } => {
  const failure = response.success ? undefined : response
  const message = failure?.error || 'Translation service unavailable'
  let entries = patchSentence(
    start,
    plan.sentenceId,
    response.success
      ? {
          chinese: response.chinese,
          status: 'loaded',
          sessionExpired: false,
          sessionUnverified: false,
        }
      : {
          errorMessage: message,
          errorHttpStatus: failure?.status,
          sessionExpired: failure?.sessionExpired === true,
          sessionUnverified: failure?.sessionUnverified === true,
          status: 'error',
        },
    plan.token
  )
  const glosses = new Map<string, { chinese: string; why: string }>()
  if (response.success) {
    for (const g of response.words) {
      const key = wordCardKey(g.word)
      if (g.chinese?.trim() && !glosses.has(key)) glosses.set(key, g)
    }
  }
  const sentence = findSentence(entries, plan.sentenceId)
  const fallbacks: FallbackRequest[] = []
  for (const request of plan.words) {
    const card = findCardByToken(
      entries,
      plan.sentenceId,
      request.key,
      request.token
    )
    if (!card) continue
    const write = (patch: Partial<WordCardData>) => {
      entries = patchCard(
        entries,
        plan.sentenceId,
        request.key,
        patch,
        request.token
      )
    }
    const gloss = glosses.get(request.key)
    if (failure) {
      write({
        contextStatus: 'error',
        contextChinese: undefined,
        contextWhy: undefined,
        contextError: message,
        contextErrorHttpStatus: failure.status,
        contextSessionExpired: failure.sessionExpired === true,
        contextSessionUnverified: failure.sessionUnverified === true,
      })
    } else if (gloss) {
      write({
        contextStatus: 'loaded',
        contextChinese: gloss.chinese,
        contextWhy: gloss.why || undefined,
        contextError: undefined,
        contextErrorHttpStatus: undefined,
        contextSessionExpired: false,
        contextSessionUnverified: false,
      })
    } else if (sentence) {
      write({
        contextFallbackPending: true,
        ...(refresh && { startedAt: now }),
      })
      fallbacks.push({
        type: 'fetchContextTranslation',
        word: card.word,
        sentence: sentence.sentence,
        sentenceId: plan.sentenceId,
        key: request.key,
        token: request.token,
        dictionaryChinese: request.dictionaryChinese,
      })
    }
  }
  return { entries, fallbacks }
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
      drafted.afterWrite?.()
      return { committed: true, plan: drafted.plan ?? [], state: capped }
    })

  const fromDraft = (draft: Draft) => draft

  return {
    read,
    transact,

    /** Mount / timer sweep: persists timed-out cards as error (Decision 5). */
    sweep: (tabId: number) => transact(tabId, state => ({ state })),

    claimSentenceEvent: (tabId: number, event: SentenceEventInput) =>
      transact(tabId, (state, now) =>
        fromDraft(claimSentence(state, event, now))
      ),

    claimPageWordEvent: (tabId: number, event: PageWordEventInput) =>
      transact(tabId, state => {
        if (state.claimedPageWordEventIds.includes(event.eventId)) {
          return { state }
        }
        const word = event.word.trim().toLowerCase()
        const key = wordCardKey(word)
        const claimed = {
          ...state,
          claimedPageWordEventIds: pushClaim(
            state.claimedPageWordEventIds,
            event.eventId
          ),
        }
        // A re-read only follows a word the panel already shows (ADR-098).
        const shown = state.entries.some(
          e => e.kind === 'word' && e.key === key
        )
        if (event.reread && !shown) return { state: claimed }
        const { loadCount, ...definition } = cardDefinition(event.ecp)
        return {
          state: {
            ...claimed,
            entries: upsertPageLookupCard(state.entries, {
              word,
              key,
              ...definition,
              // A re-read without a count leaves the card's count alone.
              ...((!event.reread || loadCount !== undefined) && { loadCount }),
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
      transact(tabId, (state, now) =>
        state.cleared
          ? {
              state: {
                ...state,
                entries: state.cleared.entries.map(entry =>
                  entry.kind === 'sentence'
                    ? {
                        ...entry,
                        words: entry.words.map(word =>
                          word.contextFallbackPending
                            ? { ...word, startedAt: now }
                            : word
                        ),
                      }
                    : entry
                ),
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
      id: string
    ) =>
      transact(tabId, state => ({
        state: {
          ...state,
          entries: removeCard(state.entries, sentenceId, id),
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
     * Writes a combined sentence-and-words response back in one transaction
     * (ADR-023 Decision 9), to the active entries and any unexpired Clear
     * snapshot. `plan` holds one individual request per still-current word
     * without a gloss; `deferred` those current only in the snapshot, which
     * the caller sends after Undo.
     */
    applySentenceWithWords: async (
      tabId: number,
      combined: CombinedPlan,
      response: CombinedResponse
    ): Promise<TransactionOutcome & { deferred: FallbackRequest[] }> => {
      let deferred: FallbackRequest[] = []
      const outcome = await transact(tabId, (state, now) => {
        const active = applyCombined(
          state.entries,
          combined,
          response,
          now,
          true
        )
        const snapshot = state.cleared
          ? applyCombined(state.cleared.entries, combined, response, now, false)
          : undefined
        const planned = new Set(active.fallbacks.map(f => f.token))
        deferred = (snapshot?.fallbacks ?? []).filter(
          f => !planned.has(f.token)
        )
        return {
          state: {
            ...state,
            entries: active.entries,
            cleared:
              state.cleared && snapshot
                ? { ...state.cleared, entries: snapshot.entries }
                : null,
          },
          plan: active.fallbacks,
        }
      })
      return { ...outcome, deferred: outcome.committed ? deferred : [] }
    },

    /** Start a fallback while the shared history still holds its visible token. */
    dispatchContextFallback: (
      tabId: number,
      request: FallbackRequest,
      send: () => void,
      defer: (state: StoredPanelHistory) => void
    ) => {
      const { sentenceId, key, token } = request
      const holds = (entries: PanelEntry[]) => {
        const card = findCardByToken(entries, sentenceId, key, token)
        return (
          card !== undefined &&
          card.contextStatus === 'loading' &&
          card.contextFallbackPending === true
        )
      }
      return transact(tabId, (state, now) => {
        if (!holds(state.entries)) {
          if (state.cleared && holds(state.cleared.entries)) defer(state)
          return { state }
        }
        return {
          state: {
            ...state,
            entries: patchCard(
              state.entries,
              sentenceId,
              key,
              { contextFallbackPending: undefined, startedAt: now },
              token
            ),
          },
          afterWrite: send,
        }
      })
    },

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
        // Failed absorbed words with a loaded dictionary share the one
        // combined request; other failed words follow their own rules.
        const absorbed = restartAbsorbed(
          state,
          entry.id,
          entry.words.filter(isRetryableAbsorbed),
          now
        )
        state = absorbed.state
        const plan: PlannedRequest[] = [
          absorbed.words.length === 0
            ? {
                type: 'translateSentence',
                sentenceId: entry.id,
                sentence: entry.sentence,
                token: alloc.token,
              }
            : {
                type: 'translateSentenceWithWords',
                sentenceId: entry.id,
                sentence: entry.sentence,
                token: alloc.token,
                words: absorbed.words,
              },
        ]
        for (const card of entry.words) {
          if (
            isFailedCard(card) &&
            !isCardLoading(card) &&
            !isRetryableAbsorbed(card)
          ) {
            const retried = retryCard(
              state,
              entry.id,
              card,
              entry.sentence,
              now
            )
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
      id: string
    ) =>
      transact(tabId, (state, now) => {
        const card = findCard(state.entries, sentenceId, id)
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
      id: string
    ) =>
      transact(tabId, (start, now) => {
        const card = findCard(start.entries, sentenceId, id)
        if (!card || card.dictionaryStatus === 'loading')
          return { state: start }
        const keepToken =
          card.contextStatus === 'loading' && card.token !== undefined
        const alloc = keepToken
          ? { state: start, token: card.token! }
          : allocateToken(start)
        return {
          state: {
            ...alloc.state,
            entries: patchCard(alloc.state.entries, sentenceId, id, {
              token: alloc.token,
              startedAt: keepToken ? (card.startedAt ?? now) : now,
              dictionaryStatus: 'loading',
              dictionaryError: undefined,
              dictionaryErrorHttpStatus: undefined,
              dictionaryErrorCode: undefined,
              dictionaryErrorUpgrade: undefined,
              dictionarySessionExpired: false,
              dictionarySessionUnverified: false,
            }),
          },
          plan: [
            {
              type: 'fetchDictionary',
              word: card.word,
              sentenceId,
              key: card.key,
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
            return fromDraft(
              retryCard(moved, sentenceId, existing, sentence, now)
            )
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
                contextSentence:
                  sentenceId === undefined ? sentence : undefined,
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
      sentenceId: string,
      language: ExplanationLanguage = 'zh-Hans'
    ) =>
      transact(tabId, (start, now) => {
        const word = rawWord.toLowerCase()
        const key = wordCardKey(word)
        const id = wordCardId(key, language)
        const existing = findCard(start.entries, sentenceId, id)
        if (existing) {
          return {
            state: {
              ...start,
              entries: reorderOrInsertCard(
                start.entries,
                sentenceId,
                id,
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
              id,
              () => ({
                word,
                key,
                explanationLanguage: language,
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
        if (!findCardByToken(state.entries, sentenceId, key, token)) {
          return { state }
        }
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
        findCardByToken(outcome.state.entries, sentenceId, key, token) !==
          undefined
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
