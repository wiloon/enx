import {
  createPanelHistoryStore,
  emptyPanelHistory,
  PANEL_HISTORY_MAX_ENTRIES,
  PANEL_HISTORY_UNDO_MS,
  panelHistoryKey,
  type PlannedRequest,
  type StoredPanelHistory,
} from '@/lib/panelHistoryStore'
import {
  PANEL_REQUEST_TIMEOUT_MS,
  PANEL_TIMEOUT_ERROR_MESSAGE,
  findCard,
  findSentence,
  patchSentence,
  sentenceCardId,
  topLevelPhraseCardKey,
  type PanelEntry,
} from '@/lib/panelHistory'
import { createFakePanelHistoryDeps } from '@/test/fakePanelHistoryDeps'

const loadedSentence = (text: string, i: number): PanelEntry => ({
  kind: 'sentence',
  id: sentenceCardId(`${text}-${i}`),
  sentence: `${text} ${i}`,
  clickedWord: '',
  status: 'loaded',
  chinese: `译${i}`,
  errorMessage: '',
  words: [],
})

const countOf = (plans: PlannedRequest[], type: PlannedRequest['type']) =>
  plans.filter(p => p.type === type).length

const SENTENCE = 'Cats are great.'
const SENTENCE_ID = sentenceCardId(SENTENCE)

describe('panelHistoryStore (ADR-090)', () => {
  it('claims a sentence event once: second claim of the same eventId returns no plan', async () => {
    const deps = createFakePanelHistoryDeps()
    const store = createPanelHistoryStore(deps)
    const event = { eventId: 'evt-1', sentence: SENTENCE, word: 'great' }

    const first = await store.claimSentenceEvent(7, event)
    expect(first.committed).toBe(true)
    expect(countOf(first.plan, 'translateSentence')).toBe(1)
    expect(first.state.entries).toHaveLength(1)

    const second = await store.claimSentenceEvent(7, event)
    expect(second.committed).toBe(true)
    expect(second.plan).toEqual([])
    expect(second.state.entries).toHaveLength(1)
  })

  it('processes two distinct events that arrive in the same millisecond', async () => {
    const deps = createFakePanelHistoryDeps({ now: () => 5 })
    const store = createPanelHistoryStore(deps)

    const a = await store.claimSentenceEvent(7, {
      eventId: 'evt-a',
      sentence: SENTENCE,
      word: '',
    })
    const b = await store.claimSentenceEvent(7, {
      eventId: 'evt-b',
      sentence: 'Dogs are great.',
      word: '',
    })
    expect(countOf(a.plan, 'translateSentence')).toBe(1)
    expect(countOf(b.plan, 'translateSentence')).toBe(1)
    expect(b.state.entries).toHaveLength(2)
  })

  it('two panels claiming different events for one sentence with an anchor word send one translation and one word lookup', async () => {
    const deps = createFakePanelHistoryDeps()
    const store = createPanelHistoryStore(deps)

    const [a, b] = await Promise.all([
      store.claimSentenceEvent(7, {
        eventId: 'evt-1',
        sentence: SENTENCE,
        word: 'great',
      }),
      store.claimSentenceEvent(7, {
        eventId: 'evt-2',
        sentence: SENTENCE,
        word: 'great',
      }),
    ])
    const plans = [...a.plan, ...b.plan]
    expect(countOf(plans, 'translateSentence')).toBe(1)
    expect(countOf(plans, 'fetchWordContext')).toBe(1)
    const stored = deps.bag[panelHistoryKey(7)]
    expect(stored.entries).toHaveLength(1)
    expect(findSentence(stored.entries, SENTENCE_ID)?.words).toHaveLength(1)
  })

  it('drops the oldest card after the 101st arrives', async () => {
    const deps = createFakePanelHistoryDeps()
    const store = createPanelHistoryStore(deps)
    deps.bag[panelHistoryKey(7)] = {
      ...emptyPanelHistory(),
      entries: Array.from({ length: PANEL_HISTORY_MAX_ENTRIES }, (_, i) =>
        loadedSentence('S', i)
      ),
      nextToken: 100,
    }

    const result = await store.claimSentenceEvent(7, {
      eventId: 'evt-new',
      sentence: 'Brand new sentence.',
      word: '',
    })
    expect(result.state.entries).toHaveLength(PANEL_HISTORY_MAX_ENTRIES)
    expect(
      result.state.entries.some(
        e => e.kind === 'sentence' && e.sentence === 'Brand new sentence.'
      )
    ).toBe(true)
    expect(
      result.state.entries.some(
        e =>
          e.kind === 'sentence' &&
          e.sentence === `S ${PANEL_HISTORY_MAX_ENTRIES - 1}`
      )
    ).toBe(false)
  })

  describe('a failed storage write', () => {
    it('commits nothing, returns no plan, leaves the event unclaimed and logs', async () => {
      const deps = createFakePanelHistoryDeps({ rejectSetTimes: 1 })
      const store = createPanelHistoryStore(deps)
      const prior: StoredPanelHistory = {
        ...emptyPanelHistory(),
        entries: [loadedSentence('Keep', 0)],
        nextToken: 3,
      }
      deps.bag[panelHistoryKey(7)] = prior
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

      const failed = await store.claimSentenceEvent(7, {
        eventId: 'evt-fail',
        sentence: 'Will not land.',
        word: '',
      })
      expect(failed.committed).toBe(false)
      expect(failed.plan).toEqual([])
      expect(failed.state.claimedSentenceEventIds).not.toContain('evt-fail')
      expect(deps.bag[panelHistoryKey(7)].entries).toHaveLength(1)
      expect(errorSpy).toHaveBeenCalled()

      // The event was not claimed, so the next delivery still processes it.
      const retried = await store.claimSentenceEvent(7, {
        eventId: 'evt-fail',
        sentence: 'Will not land.',
        word: '',
      })
      expect(retried.committed).toBe(true)
      expect(countOf(retried.plan, 'translateSentence')).toBe(1)
      errorSpy.mockRestore()
    })
  })

  it('writes nothing and returns no plan when the tab is gone', async () => {
    const deps = createFakePanelHistoryDeps({ tabExists: () => false })
    const store = createPanelHistoryStore(deps)

    const result = await store.claimSentenceEvent(7, {
      eventId: 'evt-gone',
      sentence: 'Gone tab.',
      word: '',
    })
    expect(result.committed).toBe(false)
    expect(result.plan).toEqual([])
    expect(deps.bag[panelHistoryKey(7)]).toBeUndefined()
  })

  it('a queued transaction after tab removal does not recreate the key', async () => {
    let tabAlive = true
    const deps = createFakePanelHistoryDeps({ tabExists: () => tabAlive })
    const store = createPanelHistoryStore(deps)

    let release!: () => void
    const hold = new Promise<void>(resolve => {
      release = resolve
    })
    const holder = deps.requestLock(panelHistoryKey(7), async () => {
      await hold
    })

    const queued = store.claimSentenceEvent(7, {
      eventId: 'evt-queued',
      sentence: 'Should not recreate.',
      word: '',
    })

    tabAlive = false
    const removal = store.removeForTab(7)
    release()
    await holder
    const result = await queued
    await removal
    expect(result.committed).toBe(false)
    expect(result.plan).toEqual([])
    expect(deps.bag[panelHistoryKey(7)]).toBeUndefined()
  })

  it('Clear stores expiresAt; discardClearedGeneration only drops a matching expired generation', async () => {
    let now = 1_000_000
    const deps = createFakePanelHistoryDeps({ now: () => now })
    const store = createPanelHistoryStore(deps)
    deps.bag[panelHistoryKey(7)] = {
      ...emptyPanelHistory(),
      entries: [loadedSentence('Clear me', 0)],
    }

    const cleared = await store.clear(7)
    expect(cleared.state.cleared?.generation).toBe(1)
    expect(cleared.state.cleared?.expiresAt).toBe(now + PANEL_HISTORY_UNDO_MS)
    expect(cleared.state.entries).toHaveLength(0)

    now = 1_000_000 + 1000
    await store.clear(7)
    const stale = await store.discardClearedGeneration(7, 1)
    expect(stale.state.cleared?.generation).toBe(2)

    now = 1_000_000 + 1000 + PANEL_HISTORY_UNDO_MS + 1
    const expired = await store.discardClearedGeneration(7, 2)
    expect(expired.state.cleared).toBeNull()
  })

  it('reads treat an expired Undo snapshot as absent', async () => {
    let now = 1_000
    const deps = createFakePanelHistoryDeps({ now: () => now })
    const store = createPanelHistoryStore(deps)
    deps.bag[panelHistoryKey(7)] = {
      ...emptyPanelHistory(),
      cleared: {
        generation: 1,
        entries: [loadedSentence('Hidden', 0)],
        expiresAt: 1_500,
      },
      clearGeneration: 1,
    }
    now = 2_000
    const state = await store.read(7)
    expect(state.cleared).toBeNull()
  })

  it('removeForTab deletes the history key under the history lock', async () => {
    const deps = createFakePanelHistoryDeps()
    const store = createPanelHistoryStore(deps)
    deps.bag[panelHistoryKey(7)] = {
      ...emptyPanelHistory(),
      entries: [loadedSentence('Bye', 0)],
    }
    await store.removeForTab(7)
    expect(deps.bag[panelHistoryKey(7)]).toBeUndefined()
  })

  describe('120 s request timeout (ADR-090 Decision 5)', () => {
    const setup = () => {
      let now = 10_000
      const deps = createFakePanelHistoryDeps({ now: () => now })
      const store = createPanelHistoryStore(deps)
      return {
        deps,
        store,
        advance: (ms: number) => {
          now += ms
        },
      }
    }

    it('records startedAt on each request and keeps a card loading just before the limit', async () => {
      const { store, advance } = setup()
      const claimed = await store.claimSentenceEvent(7, {
        eventId: 'e1',
        sentence: SENTENCE,
        word: 'great',
      })
      const sentence = findSentence(claimed.state.entries, SENTENCE_ID)!
      expect(sentence.startedAt).toBe(10_000)
      expect(sentence.words[0].startedAt).toBe(10_000)

      advance(PANEL_REQUEST_TIMEOUT_MS - 1)
      const swept = await store.sweep(7)
      expect(findSentence(swept.state.entries, SENTENCE_ID)?.status).toBe(
        'loading'
      )
    })

    it('turns cards loading 120 s after startedAt into Retry errors, clears tokens, and drops a late response', async () => {
      const { deps, store, advance } = setup()
      const claimed = await store.claimSentenceEvent(7, {
        eventId: 'e1',
        sentence: SENTENCE,
        word: 'great',
      })
      const token = findSentence(claimed.state.entries, SENTENCE_ID)!.token!

      advance(PANEL_REQUEST_TIMEOUT_MS)
      const swept = await store.sweep(7)
      expect(swept.committed).toBe(true)
      const sentence = findSentence(swept.state.entries, SENTENCE_ID)!
      expect(sentence.status).toBe('error')
      expect(sentence.errorMessage).toBe(PANEL_TIMEOUT_ERROR_MESSAGE)
      expect(sentence.token).toBeUndefined()
      const word = sentence.words[0]
      expect(word.dictionaryStatus).toBe('error')
      expect(word.contextStatus).toBe('error')
      expect(word.token).toBeUndefined()
      // Persisted, so every panel sees it.
      expect(
        findSentence(deps.bag[panelHistoryKey(7)].entries, SENTENCE_ID)?.status
      ).toBe('error')

      // The late response is dropped by the token rule.
      const late = await store.patchEntries(7, entries =>
        patchSentence(
          entries,
          SENTENCE_ID,
          { status: 'loaded', chinese: '迟到' },
          token
        )
      )
      expect(findSentence(late.state.entries, SENTENCE_ID)?.status).toBe(
        'error'
      )
    })

    it('sweeps inside every transaction, not only the sweep call', async () => {
      const { store, advance } = setup()
      await store.claimSentenceEvent(7, {
        eventId: 'e1',
        sentence: SENTENCE,
        word: '',
      })
      advance(PANEL_REQUEST_TIMEOUT_MS)
      const result = await store.claimPageWordEvent(7, {
        eventId: 'p1',
        word: 'fox',
        ecp: { Pronunciation: '', LoadCount: 1, Chinese: '狐狸' } as never,
      })
      expect(findSentence(result.state.entries, SENTENCE_ID)?.status).toBe(
        'error'
      )
    })

    it('does not resend by itself: the sweep returns no plan', async () => {
      const { store, advance } = setup()
      await store.claimSentenceEvent(7, {
        eventId: 'e1',
        sentence: SENTENCE,
        word: '',
      })
      advance(PANEL_REQUEST_TIMEOUT_MS)
      expect((await store.sweep(7)).plan).toEqual([])
    })

    it('honours the requestTimeoutMs seam', async () => {
      const deps = {
        ...createFakePanelHistoryDeps({ now: () => 500 }),
        requestTimeoutMs: 100,
      }
      const store = createPanelHistoryStore(deps)
      deps.bag[panelHistoryKey(7)] = {
        ...emptyPanelHistory(),
        entries: [
          {
            kind: 'sentence',
            id: SENTENCE_ID,
            token: 1,
            startedAt: 400,
            sentence: SENTENCE,
            clickedWord: '',
            status: 'loading',
            chinese: '',
            errorMessage: '',
            words: [],
          },
        ],
        nextToken: 1,
      }
      const swept = await store.sweep(7)
      expect(findSentence(swept.state.entries, SENTENCE_ID)?.status).toBe(
        'error'
      )
    })

    it('a retried sentence gets a fresh startedAt and the timeout runs from it', async () => {
      const { store, advance } = setup()
      await store.claimSentenceEvent(7, {
        eventId: 'e1',
        sentence: SENTENCE,
        word: '',
      })
      advance(PANEL_REQUEST_TIMEOUT_MS)
      await store.sweep(7)
      advance(1000)
      const retried = await store.retrySentence(7, SENTENCE_ID)
      expect(findSentence(retried.state.entries, SENTENCE_ID)?.startedAt).toBe(
        10_000 + PANEL_REQUEST_TIMEOUT_MS + 1000
      )
      advance(PANEL_REQUEST_TIMEOUT_MS - 1)
      const swept = await store.sweep(7)
      expect(findSentence(swept.state.entries, SENTENCE_ID)?.status).toBe(
        'loading'
      )
    })
  })

  describe('retries decide inside the transaction', () => {
    const failedSentence = async () => {
      const deps = createFakePanelHistoryDeps()
      const store = createPanelHistoryStore(deps)
      const claimed = await store.claimSentenceEvent(7, {
        eventId: 'e1',
        sentence: SENTENCE,
        word: '',
      })
      const token = findSentence(claimed.state.entries, SENTENCE_ID)!.token!
      await store.patchEntries(7, entries =>
        patchSentence(
          entries,
          SENTENCE_ID,
          { status: 'error', errorMessage: 'boom', token: undefined },
          token
        )
      )
      return { deps, store }
    }

    it('overlapping sentence Retry clicks from two panels send exactly one request', async () => {
      const { store } = await failedSentence()
      const [a, b] = await Promise.all([
        store.retrySentence(7, SENTENCE_ID),
        store.retrySentence(7, SENTENCE_ID),
      ])
      expect(countOf([...a.plan, ...b.plan], 'translateSentence')).toBe(1)
    })

    it('Retry on a sentence that is gone returns no plan', async () => {
      const { store } = await failedSentence()
      await store.clear(7)
      const result = await store.retrySentence(7, SENTENCE_ID)
      expect(result.plan).toEqual([])
    })

    it('overlapping Retry clicks on a failed word card send one request; one after removal sends none', async () => {
      const { store } = await failedSentence()
      await store.clickWord(7, 'Cats', SENTENCE, SENTENCE_ID)
      const loaded = await store.read(7)
      const card = findCard(loaded.entries, SENTENCE_ID, 'cats')!
      await store.patchEntries(7, entries =>
        entries.map(e =>
          e.kind === 'sentence'
            ? {
                ...e,
                words: e.words.map(w => ({
                  ...w,
                  dictionaryStatus: 'loaded' as const,
                  contextStatus: 'error' as const,
                  token: card.token,
                })),
              }
            : e
        )
      )

      const [a, b] = await Promise.all([
        store.retryContext(7, SENTENCE_ID, 'cats'),
        store.retryContext(7, SENTENCE_ID, 'cats'),
      ])
      expect(countOf([...a.plan, ...b.plan], 'fetchContextTranslation')).toBe(1)

      // Removal in one panel crossing a Retry from the other: no request.
      await store.patchEntries(7, entries =>
        entries.map(e =>
          e.kind === 'sentence'
            ? {
                ...e,
                words: e.words.map(w => ({
                  ...w,
                  contextStatus: 'error' as const,
                  token: undefined,
                })),
              }
            : e
        )
      )
      const [removed, retried] = await Promise.all([
        store.removeCard(7, SENTENCE_ID, 'cats'),
        store.retryContext(7, SENTENCE_ID, 'cats'),
      ])
      expect(removed.committed).toBe(true)
      expect(retried.plan).toEqual([])
      expect(
        findCard((await store.read(7)).entries, SENTENCE_ID, 'cats')
      ).toBeUndefined()
    })

    it('overlapping dictionary Retry clicks send one request', async () => {
      const { store } = await failedSentence()
      await store.clickWord(7, 'Cats', SENTENCE, SENTENCE_ID)
      await store.patchEntries(7, entries =>
        entries.map(e =>
          e.kind === 'sentence'
            ? {
                ...e,
                words: e.words.map(w => ({
                  ...w,
                  dictionaryStatus: 'error' as const,
                  contextStatus: 'loaded' as const,
                })),
              }
            : e
        )
      )
      const [a, b] = await Promise.all([
        store.retryDictionary(7, SENTENCE_ID, 'cats'),
        store.retryDictionary(7, SENTENCE_ID, 'cats'),
      ])
      expect(countOf([...a.plan, ...b.plan], 'fetchDictionary')).toBe(1)
    })

    it('a phrase re-selected while loading sends nothing; after failure it retries once', async () => {
      const deps = createFakePanelHistoryDeps()
      const store = createPanelHistoryStore(deps)
      const first = await store.upsertPhrase(7, 'big cats', SENTENCE, undefined)
      expect(countOf(first.plan, 'fetchContextTranslation')).toBe(1)
      const again = await store.upsertPhrase(7, 'big cats', SENTENCE, undefined)
      expect(again.plan).toEqual([])

      const key =
        first.state.entries[0].kind === 'word' && first.state.entries[0].key
      await store.patchEntries(7, entries =>
        entries.map(e =>
          e.kind === 'word' ? { ...e, contextStatus: 'error' as const } : e
        )
      )
      const [a, b] = await Promise.all([
        store.upsertPhrase(7, 'big cats', SENTENCE, undefined),
        store.upsertPhrase(7, 'big cats', SENTENCE, undefined),
      ])
      expect(key).toBeTruthy()
      expect(countOf([...a.plan, ...b.plan], 'fetchContextTranslation')).toBe(1)
    })
  })

  describe('dictionary-then-context chain', () => {
    it('markContextSent re-records startedAt while the card holds the token', async () => {
      let now = 1_000
      const deps = createFakePanelHistoryDeps({ now: () => now })
      const store = createPanelHistoryStore(deps)
      const claimed = await store.claimSentenceEvent(7, {
        eventId: 'e1',
        sentence: SENTENCE,
        word: 'great',
      })
      const word = findSentence(claimed.state.entries, SENTENCE_ID)!.words[0]
      now = 61_000
      expect(
        await store.markContextSent(7, SENTENCE_ID, word.key, word.token!)
      ).toBe(true)
      expect(
        findCard(deps.bag[panelHistoryKey(7)].entries, SENTENCE_ID, word.key)
          ?.startedAt
      ).toBe(61_000)
    })

    it('markContextSent is false (nothing to send) after the card timed out, was removed or got another token', async () => {
      let now = 1_000
      const deps = createFakePanelHistoryDeps({ now: () => now })
      const store = createPanelHistoryStore(deps)
      const claimed = await store.claimSentenceEvent(7, {
        eventId: 'e1',
        sentence: SENTENCE,
        word: 'great',
      })
      const word = findSentence(claimed.state.entries, SENTENCE_ID)!.words[0]

      expect(
        await store.markContextSent(7, SENTENCE_ID, word.key, word.token! + 50)
      ).toBe(false)

      now = 1_000 + PANEL_REQUEST_TIMEOUT_MS
      expect(
        await store.markContextSent(7, SENTENCE_ID, word.key, word.token!)
      ).toBe(false)

      await store.removeCard(7, SENTENCE_ID, word.key)
      expect(
        await store.markContextSent(7, SENTENCE_ID, word.key, word.token!)
      ).toBe(false)
    })
  })

  describe('a sentence absorbs the matching page cards (ADR-023 Decision 9)', () => {
    type Combined = Extract<
      PlannedRequest,
      { type: 'translateSentenceWithWords' }
    >
    const lookup = (
      store: ReturnType<typeof createPanelHistoryStore>,
      word: string
    ) =>
      store.claimPageWordEvent(7, {
        eventId: `lookup-${word}-${Math.random()}`,
        word,
        ecp: {
          Pronunciation: '',
          LoadCount: 1,
          Chinese: `${word}-dict`,
        } as never,
      })
    const sentenceEvent = (word: string, sentence = SENTENCE) => ({
      eventId: `s-${Math.random()}`,
      sentence,
      word,
    })
    const topKeys = (entries: PanelEntry[]) =>
      entries.map(e => (e.kind === 'word' ? e.key : 'S'))
    const setup = async () => {
      const deps = createFakePanelHistoryDeps({ now: () => 1_000 })
      const store = createPanelHistoryStore(deps)
      // Newest first: great, cats, dogs (not in the sentence).
      await lookup(store, 'dogs')
      await lookup(store, 'cats')
      await lookup(store, 'great')
      return { deps, store }
    }
    const combinedOf = (plan: PlannedRequest[]) =>
      plan.find(p => p.type === 'translateSentenceWithWords') as Combined

    it('absorbs every matching card above the first sentence, anchor first, with one combined request', async () => {
      const { store } = await setup()
      const result = await store.claimSentenceEvent(7, sentenceEvent('great'))

      expect(topKeys(result.state.entries)).toEqual(['S', 'dogs'])
      const sentence = findSentence(result.state.entries, SENTENCE_ID)!
      expect(sentence.words.map(w => w.key)).toEqual(['great', 'cats'])
      expect(sentence.words.every(w => w.contextStatus === 'loading')).toBe(
        true
      )
      expect(result.plan).toHaveLength(1)
      const combined = combinedOf(result.plan)
      expect(combined.sentenceId).toBe(SENTENCE_ID)
      expect(combined.words.map(w => [w.key, w.dictionaryChinese])).toEqual([
        ['great', 'great-dict'],
        ['cats', 'cats-dict'],
      ])
      const tokens = [combined.token, ...combined.words.map(w => w.token)]
      expect(new Set(tokens).size).toBe(3)
    })

    it('absorbs for an anchorless drag-selected sentence, in prior top-level order', async () => {
      const { store } = await setup()
      const result = await store.claimSentenceEvent(7, sentenceEvent(''))
      const sentence = findSentence(result.state.entries, SENTENCE_ID)!
      expect(sentence.words.map(w => w.key)).toEqual(['great', 'cats'])
      expect(combinedOf(result.plan).words).toHaveLength(2)
    })

    it('stops at the first sentence card; older matching cards stay at the top level', async () => {
      const { store } = await setup()
      await store.claimSentenceEvent(7, sentenceEvent('', 'Something else.'))
      await lookup(store, 'are')
      const result = await store.claimSentenceEvent(7, sentenceEvent('are'))
      expect(topKeys(result.state.entries)).toEqual([
        'S',
        'S',
        'great',
        'cats',
        'dogs',
      ])
      const sentence = findSentence(result.state.entries, SENTENCE_ID)!
      expect(sentence.words.map(w => w.key)).toEqual(['are'])
      expect(combinedOf(result.plan).words.map(w => w.key)).toEqual(['are'])
    })

    it('leaves phrase cards, scoped cards and unmatched words at the top level in order', async () => {
      const { store } = await setup()
      await store.upsertPhrase(7, 'great pets', SENTENCE, undefined)
      await store.patchEntries(7, entries =>
        entries.map(e =>
          e.kind === 'word' && e.key === 'cats'
            ? { ...e, contextStatus: 'loaded' as const }
            : e
        )
      )
      const result = await store.claimSentenceEvent(7, sentenceEvent(''))
      const sentence = findSentence(result.state.entries, SENTENCE_ID)!
      expect(sentence.words.map(w => w.key)).toEqual(['great'])
      expect(topKeys(result.state.entries)).toEqual([
        'S',
        topLevelPhraseCardKey('great pets', SENTENCE),
        'cats',
        'dogs',
      ])
    })

    it('plain translateSentence when nothing is absorbed; a seeded anchor still uses fetchWordContext', async () => {
      const deps = createFakePanelHistoryDeps()
      const store = createPanelHistoryStore(deps)
      const result = await store.claimSentenceEvent(7, sentenceEvent('great'))
      expect(result.plan.map(p => p.type)).toEqual([
        'translateSentence',
        'fetchWordContext',
      ])
    })

    it('a loaded sentence asks context individually for each newly absorbed word and leaves the sentence alone', async () => {
      const { store } = await setup()
      const first = await store.claimSentenceEvent(7, sentenceEvent('great'))
      const sentenceToken = findSentence(
        first.state.entries,
        SENTENCE_ID
      )!.token
      await store.patchEntries(7, entries =>
        patchSentence(
          entries,
          SENTENCE_ID,
          { status: 'loaded', chinese: '译' },
          sentenceToken
        )
      )
      await lookup(store, 'are')
      const again = await store.claimSentenceEvent(7, sentenceEvent('great'))
      expect(again.plan.map(p => p.type)).toEqual(['fetchContextTranslation'])
      const sentence = findSentence(again.state.entries, SENTENCE_ID)!
      expect(sentence.status).toBe('loaded')
      expect(sentence.token).toBe(sentenceToken)
      expect(sentence.words.map(w => w.key)).toEqual(['great', 'are', 'cats'])
    })

    it('a resend keeps the nested card and drops the top-level duplicate without copying data', async () => {
      const { store } = await setup()
      await store.claimSentenceEvent(7, sentenceEvent('great'))
      const before = findCard(
        (await store.read(7)).entries,
        SENTENCE_ID,
        'cats'
      )!
      await lookup(store, 'cats')
      const again = await store.claimSentenceEvent(7, sentenceEvent('great'))
      expect(topKeys(again.state.entries)).toEqual(['S', 'dogs'])
      expect(findCard(again.state.entries, SENTENCE_ID, 'cats')).toEqual(before)
      expect(countOf(again.plan, 'fetchContextTranslation')).toBe(0)
    })

    const failSentence = (
      store: ReturnType<typeof createPanelHistoryStore>,
      combined: Combined
    ) =>
      store.applySentenceWithWords(7, combined, {
        success: false,
        error: 'boom',
        status: 500,
      })

    it('a failed combined request errors the sentence and every participating word', async () => {
      const { store } = await setup()
      const claimed = await store.claimSentenceEvent(7, sentenceEvent('great'))
      const result = await failSentence(store, combinedOf(claimed.plan))
      const sentence = findSentence(result.state.entries, SENTENCE_ID)!
      expect(sentence.status).toBe('error')
      expect(sentence.errorMessage).toBe('boom')
      expect(
        sentence.words.map(w => [w.contextStatus, w.contextError])
      ).toEqual([
        ['error', 'boom'],
        ['error', 'boom'],
      ])
      expect(result.plan).toEqual([])
    })

    it('Retry and an errored resend combine the sentence with the failed absorbed words whose dictionary is loaded', async () => {
      const { store } = await setup()
      const claimed = await store.claimSentenceEvent(7, sentenceEvent('great'))
      await failSentence(store, combinedOf(claimed.plan))

      const retry = await store.retrySentence(7, SENTENCE_ID)
      expect(retry.plan.map(p => p.type)).toEqual([
        'translateSentenceWithWords',
      ])
      expect(combinedOf(retry.plan).words.map(w => w.key)).toEqual([
        'great',
        'cats',
      ])
      expect(
        findSentence(retry.state.entries, SENTENCE_ID)!.words.map(
          w => w.contextStatus
        )
      ).toEqual(['loading', 'loading'])

      await failSentence(store, combinedOf(retry.plan))
      await lookup(store, 'are')
      const resend = await store.claimSentenceEvent(7, sentenceEvent('great'))
      expect(
        combinedOf(resend.plan)
          .words.map(w => w.key)
          .sort()
      ).toEqual(['are', 'cats', 'great'])
      expect(countOf(resend.plan, 'translateSentence')).toBe(0)
    })

    it('Retry of a sentence with no absorbed words is a plain translation', async () => {
      const deps = createFakePanelHistoryDeps()
      const store = createPanelHistoryStore(deps)
      const claimed = await store.claimSentenceEvent(7, sentenceEvent(''))
      const sentenceToken = findSentence(
        claimed.state.entries,
        SENTENCE_ID
      )!.token
      await store.patchEntries(7, entries =>
        patchSentence(
          entries,
          SENTENCE_ID,
          { status: 'error', errorMessage: 'x', token: undefined },
          sentenceToken
        )
      )
      const retry = await store.retrySentence(7, SENTENCE_ID)
      expect(retry.plan.map(p => p.type)).toEqual(['translateSentence'])
    })

    describe('writing the combined response back', () => {
      const successOf = (words: Combined['words'], blank: string[] = []) => ({
        success: true as const,
        chinese: '猫很棒。',
        words: words.map(w => ({
          word: w.word,
          chinese: blank.includes(w.key) ? '' : `${w.key}-ctx`,
          why: blank.includes(w.key) ? '' : `${w.key}-why`,
        })),
      })

      it('commits glosses, and one individual plan with the existing token for each empty gloss', async () => {
        const { store } = await setup()
        const claimed = await store.claimSentenceEvent(
          7,
          sentenceEvent('great')
        )
        const combined = combinedOf(claimed.plan)
        const result = await store.applySentenceWithWords(
          7,
          combined,
          successOf(combined.words, ['cats'])
        )
        const sentence = findSentence(result.state.entries, SENTENCE_ID)!
        expect(sentence.status).toBe('loaded')
        expect(sentence.chinese).toBe('猫很棒。')
        expect(sentence.words.find(w => w.key === 'great')).toMatchObject({
          contextStatus: 'loaded',
          contextChinese: 'great-ctx',
          contextWhy: 'great-why',
        })
        expect(sentence.words.find(w => w.key === 'cats')!.contextStatus).toBe(
          'loading'
        )
        const catsRequest = combined.words.find(w => w.key === 'cats')!
        expect(result.plan).toEqual([
          {
            type: 'fetchContextTranslation',
            word: 'cats',
            sentence: SENTENCE,
            sentenceId: SENTENCE_ID,
            key: 'cats',
            token: catsRequest.token,
            dictionaryChinese: 'cats-dict',
          },
        ])
      })

      it('refreshes startedAt when the fallback plan commits', async () => {
        let now = 1_000
        const deps = createFakePanelHistoryDeps({ now: () => now })
        const store = createPanelHistoryStore(deps)
        await lookup(store, 'cats')
        const claimed = await store.claimSentenceEvent(7, sentenceEvent(''))
        const combined = combinedOf(claimed.plan)
        now = 50_000
        const result = await store.applySentenceWithWords(
          7,
          combined,
          successOf(combined.words, ['cats'])
        )
        expect(
          findCard(result.state.entries, SENTENCE_ID, 'cats')!.startedAt
        ).toBe(50_000)
      })

      it('a stale sentence token does not invalidate a current word token, and vice versa', async () => {
        const { store } = await setup()
        const claimed = await store.claimSentenceEvent(
          7,
          sentenceEvent('great')
        )
        const combined = combinedOf(claimed.plan)
        // The sentence was retried elsewhere: its token moved on.
        await store.patchEntries(7, entries =>
          patchSentence(entries, SENTENCE_ID, { token: combined.token + 99 })
        )
        // One word was replaced too.
        await store.patchEntries(7, entries =>
          entries.map(e =>
            e.kind === 'sentence'
              ? {
                  ...e,
                  words: e.words.map(w =>
                    w.key === 'cats' ? { ...w, token: w.token! + 99 } : w
                  ),
                }
              : e
          )
        )
        const result = await store.applySentenceWithWords(
          7,
          combined,
          successOf(combined.words)
        )
        const sentence = findSentence(result.state.entries, SENTENCE_ID)!
        expect(sentence.status).toBe('loading')
        expect(sentence.chinese).toBe('')
        expect(
          sentence.words.find(w => w.key === 'great')!.contextChinese
        ).toBe('great-ctx')
        expect(
          sentence.words.find(w => w.key === 'cats')!.contextChinese
        ).toBeUndefined()
      })

      it('drops the response for a removed card', async () => {
        const { store } = await setup()
        const claimed = await store.claimSentenceEvent(
          7,
          sentenceEvent('great')
        )
        const combined = combinedOf(claimed.plan)
        await store.removeCard(7, SENTENCE_ID, 'cats')
        const result = await store.applySentenceWithWords(
          7,
          combined,
          successOf(combined.words, ['great'])
        )
        expect(
          findCard(result.state.entries, SENTENCE_ID, 'cats')
        ).toBeUndefined()
        expect(result.plan.map(p => (p as { key: string }).key)).toEqual([
          'great',
        ])
      })

      it('applies to the Clear snapshot and defers the fallback until Undo', async () => {
        let now = 1_000
        const deps = createFakePanelHistoryDeps({ now: () => now })
        const store = createPanelHistoryStore(deps)
        await lookup(store, 'cats')
        const claimed = await store.claimSentenceEvent(7, sentenceEvent(''))
        const combined = combinedOf(claimed.plan)
        await store.clear(7)
        const result = await store.applySentenceWithWords(
          7,
          combined,
          successOf(combined.words, ['cats'])
        )
        expect(result.plan).toEqual([])
        expect(result.deferred.map(d => d.key)).toEqual(['cats'])
        expect(result.state.entries).toEqual([])
        const snapshot = findSentence(
          result.state.cleared!.entries,
          SENTENCE_ID
        )!
        expect(snapshot.status).toBe('loaded')

        const undone = await store.undo(7)
        expect(findSentence(undone.state.entries, SENTENCE_ID)!.chinese).toBe(
          '猫很棒。'
        )
        const cats = findCard(undone.state.entries, SENTENCE_ID, 'cats')!
        now = 3_000
        expect(
          await store.markContextSent(7, SENTENCE_ID, 'cats', cats.token!)
        ).toBe(true)
        expect(
          findCard((await store.read(7)).entries, SENTENCE_ID, 'cats')!
            .startedAt
        ).toBe(3_000)
      })

      it('a failure reaches the Clear snapshot too', async () => {
        const { store } = await setup()
        const claimed = await store.claimSentenceEvent(
          7,
          sentenceEvent('great')
        )
        await store.clear(7)
        const result = await failSentence(store, combinedOf(claimed.plan))
        const snapshot = findSentence(
          result.state.cleared!.entries,
          SENTENCE_ID
        )!
        expect(snapshot.status).toBe('error')
        expect(snapshot.words.map(w => w.contextStatus)).toEqual([
          'error',
          'error',
        ])
      })
    })
  })
})
