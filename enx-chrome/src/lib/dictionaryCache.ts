import { wrap, type DBSchema, type IDBPDatabase } from 'idb'
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

// The worker passes its own IndexedDB factory; content scripts never open it.
export function openDictionaryCache(
  factory: IDBFactory,
  version = 1
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
      await (await database).delete('entries', word.trim().toLowerCase())
    },
    async get(word: string): Promise<DictionaryEntry | undefined> {
      const tx = (await database).transaction('entries', 'readwrite')
      const row = await tx.store.get(word.trim().toLowerCase())
      if (!row || now() - row.cachedAt >= 30 * 24 * 60 * 60 * 1000) {
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
    async put(word: string, data: WordData): Promise<void> {
      const { Id, English, Pronunciation, Chinese, WordType } = data
      if (!Id || data.Origin === 'ai') return
      const row = {
        word: word.trim().toLowerCase(),
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
