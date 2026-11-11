import { wrap, type DBSchema, type IDBPDatabase } from 'idb'
import { wordKey } from '@/lib/wordHighlight'
import type { WordData } from '@/types'

export type DictionaryEntry = Pick<
  WordData,
  'Id' | 'English' | 'Pronunciation' | 'Chinese' | 'WordType'
>
interface CacheSchema extends DBSchema {
  entries: {
    key: string
    value: {
      word: string
      entry: DictionaryEntry
      cachedAt: number
      lastUsedAt: number
    }
    indexes: { lastUsedAt: number }
  }
}

// Entries are keyed by wordKey of the trimmed page form (ADR-061 Decision 1),
// so "Cat’s" and "cat" share one while "ran" and "run" stay apart. Version 1
// keyed by the lower-cased form; an upgrade drops every old entry.
const cacheKey = (word: string): string => wordKey(word.trim())

const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

// The worker passes its own IndexedDB factory; content scripts never open it.
export function openDictionaryCache(
  factory: IDBFactory,
  version = 2
): Promise<IDBPDatabase<CacheSchema>> {
  const request = factory.open('enx-dictionary-cache', version)
  request.onupgradeneeded = () => {
    const db = request.result
    if (db.objectStoreNames.contains('entries')) db.deleteObjectStore('entries')
    db.createObjectStore('entries', { keyPath: 'word' }).createIndex(
      'lastUsedAt',
      'lastUsedAt'
    )
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
    async delete(word: string): Promise<void> {
      await (await database).delete('entries', cacheKey(word))
    },
    async get(word: string): Promise<DictionaryEntry | undefined> {
      const tx = (await database).transaction('entries', 'readwrite')
      const row = await tx.store.get(cacheKey(word))
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
    async peek(word: string): Promise<DictionaryEntry | undefined> {
      const row = await (await database).get('entries', cacheKey(word))
      return row && now() - row.cachedAt < MAX_AGE_MS ? row.entry : undefined
    },
    async put(word: string, data: WordData): Promise<void> {
      const { Id, English, Pronunciation, Chinese, WordType } = data
      if (!Id || data.Origin === 'ai') return
      const row = {
        word: cacheKey(word),
        entry: { Id, English, Pronunciation, Chinese, WordType },
        cachedAt: now(),
        lastUsedAt: now(),
      }
      if (new TextEncoder().encode(JSON.stringify(row)).byteLength > 1024)
        return
      const tx = (await database).transaction('entries', 'readwrite')
      try {
        if (
          !(await tx.store.get(row.word)) &&
          (await tx.store.count()) >= 5000
        ) {
          const oldest = await tx.store.index('lastUsedAt').openCursor()
          await oldest?.delete()
        }
        await tx.store.put(row)
      } finally {
        await tx.done
      }
    },
  }
}
