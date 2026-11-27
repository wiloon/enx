import { wrap, type DBSchema, type IDBPDatabase } from 'idb'
import {
  DEFAULT_EXPLANATION_LANGUAGE,
  type ExplanationLanguage,
} from '@/lib/assumedExplanationLanguage'
import { wordKey } from '@/lib/wordHighlight'
import type { WordData } from '@/types'

export type DictionaryEntry = Pick<
  WordData,
  | 'Id'
  | 'English'
  | 'Pronunciation'
  | 'Chinese'
  | 'WordType'
  | 'ExplanationLanguage'
  | 'Senses'
  | 'LemmaNote'
  | 'PronunciationUS'
  | 'PronunciationUK'
>
interface CacheSchema extends DBSchema {
  entries: {
    key: string
    value: {
      key: string
      language: ExplanationLanguage
      word: string
      entry: DictionaryEntry
      cachedAt: number
      lastUsedAt: number
    }
    indexes: {
      lastUsedAt: number
      language: string
      languageLastUsed: [string, number]
    }
  }
}

// Entries are keyed by (explanation language, wordKey of the trimmed page
// form) (ADR-061 Decision 1, ADR-098 Decision 8). Version 2 keyed by word
// alone; an upgrade drops every old entry.
const cacheKey = (language: ExplanationLanguage, word: string): string =>
  `${language}:${wordKey(word.trim())}`

const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
const MAX_ENTRIES_PER_LANGUAGE = 5000
const MAX_BYTES_ZH = 1024
const MAX_BYTES_EN = 16 * 1024

const maxBytesFor = (language: ExplanationLanguage): number =>
  language === 'en' ? MAX_BYTES_EN : MAX_BYTES_ZH

// The worker passes its own IndexedDB factory; content scripts never open it.
export function openDictionaryCache(
  factory: IDBFactory,
  version = 3
): Promise<IDBPDatabase<CacheSchema>> {
  const request = factory.open('enx-dictionary-cache', version)
  request.onupgradeneeded = () => {
    const db = request.result
    if (db.objectStoreNames.contains('entries')) db.deleteObjectStore('entries')
    const store = db.createObjectStore('entries', { keyPath: 'key' })
    store.createIndex('lastUsedAt', 'lastUsedAt')
    store.createIndex('language', 'language')
    store.createIndex('languageLastUsed', ['language', 'lastUsedAt'])
  }
  const opened = wrap(request) as Promise<IDBPDatabase<CacheSchema>>
  return opened.then(db => {
    db.onversionchange = () => db.close()
    return db
  })
}

export function createDictionaryCache(
  database: Promise<IDBPDatabase<CacheSchema>>,
  now: () => number,
  onWriteError: (error: unknown) => void = () => {}
) {
  return {
    async clear(): Promise<void> {
      await (await database).clear('entries')
    },
    async delete(
      word: string,
      language: ExplanationLanguage = DEFAULT_EXPLANATION_LANGUAGE
    ): Promise<void> {
      await (await database).delete('entries', cacheKey(language, word))
    },
    async get(
      word: string,
      language: ExplanationLanguage = DEFAULT_EXPLANATION_LANGUAGE
    ): Promise<DictionaryEntry | undefined> {
      const tx = (await database).transaction('entries', 'readwrite')
      const row = await tx.store.get(cacheKey(language, word))
      if (!row || now() - row.cachedAt >= MAX_AGE_MS) {
        await tx.done
        return undefined
      }
      try {
        await tx.store.put({ ...row, lastUsedAt: now() })
        await tx.done
      } catch (error) {
        await tx.done.catch(() => {})
        onWriteError(error)
      }
      return row.entry
    },
    // A usable entry for the prefetch's "is it cached?", which is no use of
    // the word: its last-used time, and so its LRU place, stays.
    async peek(
      word: string,
      language: ExplanationLanguage = DEFAULT_EXPLANATION_LANGUAGE
    ): Promise<DictionaryEntry | undefined> {
      const row = await (await database).get('entries', cacheKey(language, word))
      return row && now() - row.cachedAt < MAX_AGE_MS ? row.entry : undefined
    },
    async put(
      word: string,
      data: WordData,
      language: ExplanationLanguage = DEFAULT_EXPLANATION_LANGUAGE
    ): Promise<void> {
      const {
        Id,
        English,
        Pronunciation,
        Chinese,
        WordType,
        ExplanationLanguage,
        Senses,
        LemmaNote,
        PronunciationUS,
        PronunciationUK,
      } = data
      if (!Id || data.Origin === 'ai') return
      const entry: DictionaryEntry = {
        Id,
        English,
        Pronunciation,
        Chinese,
        WordType,
        ...(ExplanationLanguage ? { ExplanationLanguage } : {}),
        ...(Senses ? { Senses } : {}),
        ...(LemmaNote ? { LemmaNote } : {}),
        ...(PronunciationUS ? { PronunciationUS } : {}),
        ...(PronunciationUK ? { PronunciationUK } : {}),
      }
      const row = {
        key: cacheKey(language, word),
        language,
        word: wordKey(word.trim()),
        entry,
        cachedAt: now(),
        lastUsedAt: now(),
      }
      if (
        new TextEncoder().encode(JSON.stringify(row)).byteLength >
        maxBytesFor(language)
      )
        return
      const tx = (await database).transaction('entries', 'readwrite')
      try {
        if (!(await tx.store.get(row.key))) {
          const count = await tx.store
            .index('language')
            .count(IDBKeyRange.only(language))
          if (count >= MAX_ENTRIES_PER_LANGUAGE) {
            const oldest = await tx.store
              .index('languageLastUsed')
              .openCursor(
                IDBKeyRange.bound([language, 0], [language, Number.MAX_SAFE_INTEGER])
              )
            await oldest?.delete()
          }
        }
        await tx.store.put(row)
      } finally {
        await tx.done
      }
    },
  }
}
