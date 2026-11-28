// Word card identity by explanation language (ADR-023 Decision 8, #1235).

import {
  createPanelHistoryStore,
  emptyPanelHistory,
  panelHistoryKey,
} from '@/lib/panelHistoryStore'
import type { WordEntry } from '@/lib/panelHistory'
import { createFakePanelHistoryDeps } from '@/test/fakePanelHistoryDeps'
import type { WordData } from '@/types'

const zh: WordData = {
  Key: 'went',
  English: 'went',
  Pronunciation: 'went',
  Chinese: 'v. 去',
  LoadCount: 3,
  WordType: 0,
}

const en: WordData = {
  Key: 'went',
  English: 'went',
  Pronunciation: '',
  Chinese: '',
  LoadCount: 4,
  WordType: 0,
  ExplanationLanguage: 'en',
  Senses: [{ pos: 'verb', gloss: 'To move.', example: 'We go.' }],
  LemmaNote: 'past tense of go',
  PronunciationUS: '/wɛnt/',
  PronunciationUK: '/wɛnt/',
}

let eventNumber = 0

const setup = () => {
  const deps = createFakePanelHistoryDeps()
  const store = createPanelHistoryStore(deps)
  const claim = (ecp: WordData, reread?: boolean) =>
    store.claimPageWordEvent(7, {
      eventId: `evt-${++eventNumber}`,
      word: 'went',
      ecp,
      ...(reread && { reread }),
    })
  const cards = async () => (await store.read(7)).entries as WordEntry[]
  return { deps, store, claim, cards }
}

describe('page lookup cards and the explanation language', () => {
  it('adds an English card beside the Chinese one, which stays unchanged', async () => {
    const { claim, cards } = setup()
    await claim(zh)
    const [older] = await cards()

    await claim(en)

    const after = await cards()
    expect(after).toHaveLength(2)
    expect(after[0]).toMatchObject({
      explanationLanguage: 'en',
      senses: en.Senses,
      lemmaNote: 'past tense of go',
      pronunciationUS: '/wɛnt/',
      pronunciationUK: '/wɛnt/',
      loadCount: 4,
    })
    expect(after[1]).toEqual(older)
  })

  it('treats a stored card without a language as zh-Hans', async () => {
    const { deps, store, claim, cards } = setup()
    await deps.storage.set(panelHistoryKey(7), {
      ...emptyPanelHistory(),
      entries: [
        {
          kind: 'word',
          word: 'went',
          key: 'went',
          dictionaryChinese: '旧释义',
          dictionaryStatus: 'loaded',
          contextStatus: 'none',
        },
      ],
    })
    expect((await store.read(7)).entries).toHaveLength(1)

    await claim(zh)
    expect(await cards()).toHaveLength(1)

    await claim(en)
    expect(await cards()).toHaveLength(2)
  })
})

describe('a re-read after the explanation language switched', () => {
  it('adds a card in the new language, and merges back into the first on the way back', async () => {
    const { claim, cards } = setup()
    await claim(zh)

    await claim(en, true)
    await claim({ ...zh, LoadCount: undefined }, true)

    const after = await cards()
    expect(after.map(c => c.explanationLanguage)).toEqual(['zh-Hans', 'en'])
    // A re-read counts nothing, so it does not blank the count either.
    expect(after[0].loadCount).toBe(3)
  })

  it('adds nothing for a word with no top-level card, and keeps the Undo window', async () => {
    const { store, claim, cards } = setup()
    await claim(zh)
    await store.clear(7)

    await claim(en, true)

    expect(await cards()).toEqual([])
    expect((await store.read(7)).cleared?.entries).toHaveLength(1)
  })

  it('still inserts a card for a counted lookup into an empty panel', async () => {
    const { claim, cards } = setup()

    await claim(en)

    expect(await cards()).toHaveLength(1)
  })
})
