/** @jest-environment node */
import 'fake-indexeddb/auto'
import {
  createDictionaryCache,
  openDictionaryCache,
} from '@/lib/dictionaryCache'
import type { WordData } from '@/types'

const definition: WordData = {
  Id: 'run-id',
  Key: 'run',
  English: 'run',
  Pronunciation: 'rʌn',
  Chinese: '跑',
  WordType: 0,
  LoadCount: 7,
  Known: true,
  AIFallback: { CanUse: true, Auto: true },
}

const englishDefinition: WordData = {
  Id: 'run-en',
  Key: 'run',
  English: 'run',
  Pronunciation: '',
  Chinese: '',
  WordType: 0,
  ExplanationLanguage: 'en',
  Origin: 'wiktionary',
  Senses: [
    { pos: 'v', gloss: 'To move fast.', example: 'Run home.' },
    { pos: 'n', gloss: 'A spell of running.' },
  ],
  LemmaNote: 'also past tense of something long enough to grow',
  PronunciationUS: '/rʌn/',
  PronunciationUK: '/ɹʌn/',
}

let factory: IDBFactory
let now: number
const cache = () =>
  createDictionaryCache(openDictionaryCache(factory), () => now)
beforeEach(() => {
  factory = new IDBFactory()
  now = 1000
})

it('reuses a clicked inflection across cache instances without persisting user state', async () => {
  await cache().put(' Ran ', definition, 'zh-Hans')
  expect(await cache().get('RAN', 'zh-Hans')).toEqual({
    Id: 'run-id',
    English: 'run',
    Pronunciation: 'rʌn',
    Chinese: '跑',
    WordType: 0,
  })
  expect(await cache().get('run', 'zh-Hans')).toBeUndefined()
})

it('keeps the same word in both languages side by side', async () => {
  await cache().put('run', definition, 'zh-Hans')
  await cache().put('run', englishDefinition, 'en')
  expect((await cache().get('run', 'zh-Hans'))?.Chinese).toBe('跑')
  expect((await cache().get('run', 'en'))?.Senses?.[0]?.gloss).toBe(
    'To move fast.'
  )
  expect(await cache().get('run', 'zh-Hans')).toMatchObject({ Chinese: '跑' })
})

it('caches an English entry that is larger than 1 KB', async () => {
  const large: WordData = {
    ...englishDefinition,
    Senses: Array.from({ length: 10 }, (_, i) => ({
      pos: 'n',
      gloss: `Gloss number ${i} with enough text to push past one kilobyte of UTF-8 when stored with the other English fields. `.repeat(
        2
      ),
      example: `Example ${i} also adds a few dozen bytes of overhead.`,
    })),
  }
  const encoded = new TextEncoder().encode(JSON.stringify(large.Senses))
  expect(encoded.byteLength).toBeGreaterThan(1024)
  await cache().put('light', large, 'en')
  expect(await cache().get('light', 'en')).toMatchObject({ Id: 'run-en' })
})

it(
  'filling one language to the cap evicts nothing of the other',
  async () => {
    const store = cache()
    await store.put('keep-zh', definition, 'zh-Hans')
    for (let i = 0; i < 5000; i++) {
      now++
      await store.put(`en-${i}`, englishDefinition, 'en')
    }
    now++
    await store.put('en-new', englishDefinition, 'en')
    expect(await store.get('keep-zh', 'zh-Hans')).toBeDefined()
    expect(await store.get('en-0', 'en')).toBeUndefined()
    expect(await store.get('en-new', 'en')).toBeDefined()
  },
  30_000
)

it('shares one entry between a possessive page form and its word', async () => {
  await cache().put('Cat’s', { ...definition, Id: 'cat-id', English: 'cat' })
  expect(await cache().get('cat')).toMatchObject({ Id: 'cat-id' })
  await cache().delete("CAT's")
  expect(await cache().get('Cat’s')).toBeUndefined()
})

it('expires after 30 days from insertion even when read just before expiry', async () => {
  const store = cache()
  await store.put('ran', definition)
  now += 30 * 24 * 60 * 60 * 1000 - 1
  expect(await store.get('ran')).toBeDefined()
  now++
  expect(await store.get('ran')).toBeUndefined()
})

it('peeks at a usable entry without refreshing its last use, and not past expiry', async () => {
  const store = cache()
  await store.put('Ran', definition)
  const put = jest.spyOn(IDBObjectStore.prototype, 'put')
  try {
    expect(await store.peek('ran')).toMatchObject({ Id: 'run-id' })
    expect(await store.peek('run')).toBeUndefined()
    now += 30 * 24 * 60 * 60 * 1000
    expect(await store.peek('ran')).toBeUndefined()
    expect(put).not.toHaveBeenCalled()
  } finally {
    put.mockRestore()
  }
})

it.each([
  ['a miss', { Id: undefined }],
  ['an AI definition', { Origin: 'ai' as const }],
  ['more than 1 KB of UTF-8 Chinese data', { Chinese: '词'.repeat(350) }],
])('does not cache %s', async (_name, fields) => {
  const store = cache()
  await store.put('ran', { ...definition, ...fields })
  expect(await store.get('ran')).toBeUndefined()
})

it(
  'evicts the least recently used word at 5000 entries per language',
  async () => {
    const store = cache()
    for (let i = 0; i < 5000; i++) {
      now++
      await store.put(`word-${i}`, definition)
    }
    now++
    await store.get('word-0')
    now++
    await Promise.all([
      store.put('new-a', definition),
      store.put('new-b', definition),
    ])
    expect(await store.get('word-0')).toBeDefined()
    expect(await store.get('word-1')).toBeUndefined()
    expect(await store.get('word-2')).toBeUndefined()
    expect(await store.get('new-a')).toBeDefined()
    expect(await store.get('new-b')).toBeDefined()
  },
  30_000
)

it(
  'overwrites an existing word at capacity without evicting another',
  async () => {
    const store = cache()
    for (let i = 0; i < 5000; i++) {
      now++
      await store.put(`word-${i}`, definition)
    }
    await store.put('word-200', { ...definition, Chinese: '更新' })
    expect((await store.get('word-200'))?.Chinese).toBe('更新')
    expect(await store.get('word-0')).toBeDefined()
  },
  30_000
)

it('discards entries stored under the old version 2 keys', async () => {
  const db = await openDictionaryCache(factory, 2)
  await createDictionaryCache(Promise.resolve(db), () => now).put(
    'ran',
    definition
  )
  db.close()
  const upgraded = await openDictionaryCache(factory)
  expect(
    await createDictionaryCache(Promise.resolve(upgraded), () => now).get('ran')
  ).toBeUndefined()
  upgraded.close()
})

it('invalidates a stale word id without removing another definition', async () => {
  const store = cache()
  await store.put('ran', definition)
  await store.put('run', definition)
  await store.delete(' RAN ')
  expect(await store.get('ran')).toBeUndefined()
  expect(await store.get('run')).toBeDefined()
})

it('clears all definitions on explicit sign-out', async () => {
  const store = cache()
  await store.put('ran', definition)
  await store.put('run', definition)
  await store.clear()
  expect(await store.get('ran')).toBeUndefined()
  expect(await store.get('run')).toBeUndefined()
})
