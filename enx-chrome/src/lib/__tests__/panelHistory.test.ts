import {
  normalizeCardText,
  patchCard,
  patchSentence,
  reorderOrInsertCard,
  sentenceCardId,
  topLevelPhraseCardKey,
  wordCardKey,
  type PanelEntry,
  type SentenceEntry,
  type WordCardData,
} from '@/lib/panelHistory'

const card = (word: string, extra: Partial<WordCardData> = {}) => ({
  word,
  key: wordCardKey(word),
  dictionaryStatus: 'none' as const,
  contextStatus: 'loaded' as const,
  ...extra,
})

const sentence = (
  text: string,
  words: WordCardData[] = [],
  extra: Partial<SentenceEntry> = {}
): SentenceEntry => ({
  kind: 'sentence',
  id: sentenceCardId(text),
  sentence: text,
  clickedWord: '',
  status: 'loaded',
  chinese: '',
  errorMessage: '',
  words,
  ...extra,
})

describe('normalizeCardText', () => {
  it('trims, collapses whitespace runs and lower-cases', () => {
    expect(normalizeCardText('  Great \t\n  Pets ')).toBe('great pets')
  })
})

describe('sentenceCardId', () => {
  it('is the same for sentences that differ only in whitespace or case', () => {
    expect(sentenceCardId('Cats are  great.')).toBe(
      sentenceCardId(' cats are great. ')
    )
  })

  it('differs for different sentences', () => {
    expect(sentenceCardId('Cats are great.')).not.toBe(
      sentenceCardId('Dogs are great.')
    )
  })
})

describe('card keys', () => {
  it('keys a word or nested card by its normalised text', () => {
    expect(wordCardKey(' Great  Pets')).toBe(wordCardKey('great pets'))
  })

  it('keys a top-level phrase by phrase and context sentence together', () => {
    expect(topLevelPhraseCardKey('Great pets', 'Cats are great pets.')).toBe(
      topLevelPhraseCardKey('great  pets', ' cats are great pets. ')
    )
    expect(
      topLevelPhraseCardKey('great pets', 'Cats are great pets.')
    ).not.toBe(topLevelPhraseCardKey('great pets', 'Dogs are great pets.'))
  })

  it('never gives a top-level phrase the key of a word card', () => {
    expect(topLevelPhraseCardKey('great', 'Great.')).not.toBe(
      wordCardKey('great')
    )
  })
})

describe('reorderOrInsertCard', () => {
  it('moves an existing top-level card to the front, keeping its data', () => {
    const entries: PanelEntry[] = [
      { kind: 'word', ...card('cats') },
      { kind: 'word', ...card('Great', { contextChinese: '很棒' }) },
    ]
    const next = reorderOrInsertCard(
      entries,
      undefined,
      wordCardKey('great'),
      () => card('new')
    )
    expect(next.map(e => (e.kind === 'word' ? e.word : e.id))).toEqual([
      'Great',
      'cats',
    ])
    expect(next[0]).toBe(entries[1])
  })

  it('inserts a new card at the front of a sentence when the key is new', () => {
    const s = sentence('Cats are great.', [card('cats')])
    const next = reorderOrInsertCard([s], s.id, wordCardKey('great'), () =>
      card('great')
    )
    expect((next[0] as SentenceEntry).words.map(w => w.word)).toEqual([
      'great',
      'cats',
    ])
  })
})

describe('token guard', () => {
  it('writes a card response only while the card still carries its token', () => {
    const s = sentence('Cats are great.', [
      card('great', { contextStatus: 'loading', token: 2 }),
    ])
    const stale = patchCard(
      [s],
      s.id,
      wordCardKey('great'),
      { contextStatus: 'loaded' },
      1
    )
    expect(stale).toEqual([s])
    const current = patchCard(
      [s],
      s.id,
      wordCardKey('great'),
      { contextStatus: 'loaded' },
      2
    )
    expect((current[0] as SentenceEntry).words[0].contextStatus).toBe('loaded')
  })

  it('writes a sentence response only while the card still carries its token', () => {
    const s = sentence('Cats are great.', [], { status: 'loading', token: 5 })
    expect(patchSentence([s], s.id, { status: 'loaded' }, 4)).toEqual([s])
    expect(
      (patchSentence([s], s.id, { status: 'loaded' }, 5)[0] as SentenceEntry)
        .status
    ).toBe('loaded')
  })
})
