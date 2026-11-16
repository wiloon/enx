import {
  createPanelHistoryStore,
  emptyPanelHistory,
  PANEL_HISTORY_MAX_ENTRIES,
  PANEL_HISTORY_UNDO_MS,
  PANEL_ORPHAN_ERROR_MESSAGE,
  panelHistoryKey,
  type StoredPanelHistory,
} from '@/lib/panelHistoryStore'
import { sentenceCardId, type PanelEntry } from '@/lib/panelHistory'
import { createFakePanelHistoryDeps } from '@/test/fakePanelHistoryDeps'
import type { WordData } from '@/types'

const ecp = (word: string): WordData => ({
  Id: `id-${word}`,
  Key: word,
  English: word,
  Pronunciation: '',
  Chinese: `${word}中文`,
  LoadCount: 1,
  Known: false,
})

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

describe('panelHistoryStore (ADR-090)', () => {
  it('claims a sentence event once: second claim of the same eventId returns no plan', async () => {
    const deps = createFakePanelHistoryDeps()
    const store = createPanelHistoryStore(deps)
    const event = {
      eventId: 'evt-1',
      sentence: 'Cats are great.',
      word: 'great',
    }

    const first = await store.claimSentenceEvent(7, 'panel-a', event)
    expect(first.committed).toBe(true)
    expect(first.plan.some(p => p.type === 'translateSentence')).toBe(true)
    expect(first.state.entries).toHaveLength(1)

    const second = await store.claimSentenceEvent(7, 'panel-b', event)
    expect(second.committed).toBe(true)
    expect(second.plan).toEqual([])
    expect(second.state.entries).toHaveLength(1)
  })

  it('processes two distinct events that share createdAt-equivalent timing', async () => {
    const deps = createFakePanelHistoryDeps()
    const store = createPanelHistoryStore(deps)

    const a = await store.claimSentenceEvent(7, 'panel-a', {
      eventId: 'evt-a',
      sentence: 'Cats are great.',
      word: '',
    })
    // Finish the first translation so a second distinct event for the same
    // sentence only reorders when already loaded (no new translate).
    await store.patchEntries(7, entries =>
      entries.map(e =>
        e.kind === 'sentence'
          ? { ...e, status: 'loaded' as const, chinese: '猫很好。', token: undefined }
          : e
      )
    )

    const b = await store.claimSentenceEvent(7, 'panel-a', {
      eventId: 'evt-b',
      sentence: 'Dogs are great.',
      word: '',
    })
    expect(a.plan.filter(p => p.type === 'translateSentence')).toHaveLength(1)
    expect(b.plan.filter(p => p.type === 'translateSentence')).toHaveLength(1)
    expect(b.state.entries).toHaveLength(2)
  })

  it('does not re-translate a sentence already loading when a second event names it', async () => {
    const deps = createFakePanelHistoryDeps()
    const store = createPanelHistoryStore(deps)

    const first = await store.claimSentenceEvent(7, 'panel-a', {
      eventId: 'evt-1',
      sentence: 'Cats are great.',
      word: '',
    })
    const second = await store.claimSentenceEvent(7, 'panel-b', {
      eventId: 'evt-2',
      sentence: 'Cats are great.',
      word: '',
    })
    expect(first.plan.filter(p => p.type === 'translateSentence')).toHaveLength(
      1
    )
    expect(second.plan.filter(p => p.type === 'translateSentence')).toHaveLength(
      0
    )
  })

  it('drops the oldest card after the 101st arrives', async () => {
    const deps = createFakePanelHistoryDeps()
    const store = createPanelHistoryStore(deps)
    const seeded: StoredPanelHistory = {
      ...emptyPanelHistory(),
      entries: Array.from({ length: PANEL_HISTORY_MAX_ENTRIES }, (_, i) =>
        loadedSentence('S', i)
      ),
      nextToken: 100,
    }
    deps.bag[panelHistoryKey(7)] = seeded

    const result = await store.claimSentenceEvent(7, 'panel-a', {
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
    // Newest-on-top: the seeded list had S 0 at the front (newest of the
    // seed) and S 99 at the end (oldest); the cap drops the end.
    expect(
      result.state.entries.some(
        e => e.kind === 'sentence' && e.sentence === `S ${PANEL_HISTORY_MAX_ENTRIES - 1}`
      )
    ).toBe(false)
  })

  it('on quota failure trims the oldest half and retries; keeps tokens and claims', async () => {
    const deps = createFakePanelHistoryDeps({ rejectSetTimes: 1 })
    const store = createPanelHistoryStore(deps)
    deps.bag[panelHistoryKey(7)] = {
      ...emptyPanelHistory(),
      entries: Array.from({ length: 4 }, (_, i) => loadedSentence('Q', i)),
      nextToken: 9,
      claimedSentenceEventIds: ['old-claim'],
    }

    const result = await store.claimSentenceEvent(7, 'panel-a', {
      eventId: 'evt-q',
      sentence: 'Quota check.',
      word: '',
    })
    expect(result.committed).toBe(true)
    expect(result.state.nextToken).toBeGreaterThan(9)
    expect(result.state.claimedSentenceEventIds).toContain('old-claim')
    expect(result.state.claimedSentenceEventIds).toContain('evt-q')
    // Half of 5 (4 old + 1 new, capped then half) → ceil(5/2)=3 after trim path
    // Actually: write fails on full state, trimOldestHalf of capped entries.
    expect(result.state.entries.length).toBeLessThanOrEqual(3)
  })

  it('when the quota retry also fails, keeps last committed state and leaves the event unclaimed', async () => {
    const deps = createFakePanelHistoryDeps({ rejectSetTimes: 2 })
    const store = createPanelHistoryStore(deps)
    const prior: StoredPanelHistory = {
      ...emptyPanelHistory(),
      entries: [loadedSentence('Keep', 0)],
      nextToken: 3,
    }
    deps.bag[panelHistoryKey(7)] = prior

    const result = await store.claimSentenceEvent(7, 'panel-a', {
      eventId: 'evt-fail',
      sentence: 'Will not land.',
      word: '',
    })
    expect(result.committed).toBe(false)
    expect(result.plan).toEqual([])
    expect(result.state.entries).toHaveLength(1)
    expect(result.state.claimedSentenceEventIds).not.toContain('evt-fail')
    expect(deps.bag[panelHistoryKey(7)].entries).toHaveLength(1)
  })

  it('writes nothing and returns no plan when the tab is gone', async () => {
    const deps = createFakePanelHistoryDeps({ tabExists: () => false })
    const store = createPanelHistoryStore(deps)

    const result = await store.claimSentenceEvent(7, 'panel-a', {
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
    const lockName = panelHistoryKey(7)

    // Hold the lock while we remove the tab and queue a transaction.
    let release!: () => void
    const hold = new Promise<void>(resolve => {
      release = resolve
    })
    const holder = deps.requestLock(lockName, async () => {
      await hold
    })

    const queued = store.claimSentenceEvent(7, 'panel-a', {
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

    // Old timer must not wipe a newer Clear.
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

  it('orphanOwner turns that owner’s loading cards into Retry errors and clears tokens', async () => {
    const deps = createFakePanelHistoryDeps()
    const store = createPanelHistoryStore(deps)
    deps.bag[panelHistoryKey(7)] = {
      ...emptyPanelHistory(),
      entries: [
        {
          kind: 'sentence',
          id: sentenceCardId('Loading.'),
          token: 5,
          ownerInstanceId: 'owner-1',
          sentence: 'Loading.',
          clickedWord: '',
          status: 'loading',
          chinese: '',
          errorMessage: '',
          words: [
            {
              word: 'load',
              key: 'load',
              token: 6,
              ownerInstanceId: 'owner-1',
              dictionaryStatus: 'loading',
              contextStatus: 'loading',
            },
          ],
        },
        {
          kind: 'sentence',
          id: sentenceCardId('Other owner.'),
          token: 7,
          ownerInstanceId: 'owner-2',
          sentence: 'Other owner.',
          clickedWord: '',
          status: 'loading',
          chinese: '',
          errorMessage: '',
          words: [],
        },
      ],
      nextToken: 7,
    }

    const result = await store.orphanOwner(7, 'owner-1')
    const first = result.state.entries[0]
    expect(first.kind).toBe('sentence')
    if (first.kind === 'sentence') {
      expect(first.status).toBe('error')
      expect(first.errorMessage).toBe(PANEL_ORPHAN_ERROR_MESSAGE)
      expect(first.token).toBeUndefined()
      expect(first.words[0].contextStatus).toBe('error')
      expect(first.words[0].token).toBeUndefined()
    }
    const second = result.state.entries[1]
    expect(second.kind).toBe('sentence')
    if (second.kind === 'sentence') {
      expect(second.status).toBe('loading')
      expect(second.token).toBe(7)
    }
  })

  it('flushes pending errors at the start of a later transaction', async () => {
    const deps = createFakePanelHistoryDeps()
    const store = createPanelHistoryStore(deps)
    const id = sentenceCardId('Pending.')
    deps.bag[panelHistoryKey(7)] = {
      ...emptyPanelHistory(),
      entries: [
        {
          kind: 'sentence',
          id,
          token: 1,
          ownerInstanceId: 'owner-1',
          sentence: 'Pending.',
          clickedWord: '',
          status: 'loading',
          chinese: '',
          errorMessage: '',
          words: [],
        },
      ],
      nextToken: 1,
    }

    const result = await store.claimPageWordEvent(
      7,
      'owner-1',
      {
        eventId: 'pw-1',
        word: 'fox',
        ecp: ecp('fox'),
      },
      [
        {
          sentenceId: undefined,
          key: id,
          kind: 'sentence',
          sentencePatch: {
            status: 'error',
            errorMessage: PANEL_ORPHAN_ERROR_MESSAGE,
            token: undefined,
          },
        },
      ]
    )
    expect(result.committed).toBe(true)
    expect(result.remainingPending).toEqual([])
    const sentence = result.state.entries.find(
      e => e.kind === 'sentence' && e.id === id
    )
    expect(sentence?.kind === 'sentence' && sentence.status).toBe('error')
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
})
