// The one writer for reading positions (ADR-082). Tabs send each action as it
// happens; the background binds it to the Clerk user signed in on receipt,
// holds it 2 s per user and book so a burst of lookups is one write, and runs
// every storage mutation in order. A pending action stays bound to the user
// who made it, so an account switch never moves it to another account. A
// worker restart during the 2 s loses what was pending; the stored position
// is untouched. Errors carry codes only: no sentence or address is logged.

import {
  FEATURE_BUDGET_BYTES,
  SHARED_QUOTA_BYTES,
  STORAGE_PREFIX,
  checkAnchor,
  readUserBooks,
  storageKeyFor,
  storedBytes,
  withOpened,
  withPosition,
  type AnchorRejection,
  type ReadingAnchor,
  type UserBooks,
} from '@/lib/readingPositions'

export const WRITE_DEBOUNCE_MS = 2000

export interface ReadingPositionStorage {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<void>
  keys: () => Promise<string[]>
  /** Bytes in use for these keys, or for everything with null. */
  bytesInUse: (keys: string[] | null) => Promise<number>
}

export interface ReadingPositionWriterDeps {
  storage: ReadingPositionStorage
  /** The signed-in Clerk user, or null when signed out. */
  currentUserId: () => Promise<string | null>
  now?: () => number
}

export type WriteFailure =
  AnchorRejection | 'signed-out' | 'storage-full' | 'write-failed'

export type WriteResult = { ok: true } | { ok: false; code: WriteFailure }

export type OpenResult =
  | { ok: true; position: ReadingAnchor | null }
  | { ok: false; code: 'signed-out' }

interface Pending {
  userId: string
  bookKey: string
  anchor: ReadingAnchor
  timer: ReturnType<typeof setTimeout>
  waiters: ((result: WriteResult) => void)[]
}

export function createReadingPositionWriter(deps: ReadingPositionWriterDeps) {
  const { storage, currentUserId } = deps
  const now = deps.now ?? Date.now
  const pending = new Map<string, Pending>()
  // Actions still finding out their user; a flush waits for them.
  const receiving = new Set<Promise<unknown>>()
  let queue: Promise<unknown> = Promise.resolve()

  const serialized = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task)
    queue = run.catch(() => {})
    return run
  }

  const readBooks = async (userId: string) =>
    readUserBooks(await storage.get(storageKeyFor(userId)))

  const fitsBudget = async (key: string, next: UserBooks) => {
    const growth = storedBytes(key, next) - (await storage.bytesInUse([key]))
    const featureKeys = (await storage.keys()).filter(k =>
      k.startsWith(STORAGE_PREFIX)
    )
    return (
      (await storage.bytesInUse(featureKeys)) + growth <=
        FEATURE_BUDGET_BYTES &&
      (await storage.bytesInUse(null)) + growth <= SHARED_QUOTA_BYTES
    )
  }

  const persist = (
    userId: string,
    bookKey: string,
    anchor: ReadingAnchor
  ): Promise<WriteResult> =>
    serialized(async () => {
      const key = storageKeyFor(userId)
      try {
        const next = withPosition(
          await readBooks(userId),
          bookKey,
          anchor,
          now()
        )
        if (!(await fitsBudget(key, next))) {
          console.warn('Reading position not saved: storage-full')
          return { ok: false, code: 'storage-full' }
        }
        await storage.set(key, next)
        return { ok: true }
      } catch {
        console.warn('Reading position not saved: write-failed')
        return { ok: false, code: 'write-failed' }
      }
    })

  const flushOne = async (id: string) => {
    const entry = pending.get(id)
    if (!entry) return
    pending.delete(id)
    clearTimeout(entry.timer)
    const result = await persist(entry.userId, entry.bookKey, entry.anchor)
    entry.waiters.forEach(resolve => resolve(result))
    return result
  }

  // Binds the action to the user signed in now and queues it; settles once
  // the action is pending or refused, which is what a flush waits for.
  const receive = async (
    bookKey: unknown,
    rawAnchor: unknown,
    reply: (result: WriteResult) => void
  ) => {
    const userId = await currentUserId()
    if (!userId) return reply({ ok: false, code: 'signed-out' })
    const checked = checkAnchor(bookKey, rawAnchor)
    if (!checked.ok) return reply(checked)
    const id = `${userId}\n${bookKey as string}`
    const entry = pending.get(id)
    if (entry) clearTimeout(entry.timer)
    const anchor =
      entry && entry.anchor.occurredAt > checked.anchor.occurredAt
        ? entry.anchor
        : checked.anchor
    pending.set(id, {
      userId,
      bookKey: bookKey as string,
      anchor,
      waiters: [...(entry?.waiters ?? []), reply],
      timer: setTimeout(() => void flushOne(id), WRITE_DEBOUNCE_MS),
    })
  }

  const record = (bookKey: unknown, rawAnchor: unknown) =>
    new Promise<WriteResult>(reply => {
      const receipt = receive(bookKey, rawAnchor, reply).catch(() =>
        reply({ ok: false, code: 'write-failed' })
      )
      receiving.add(receipt)
      void receipt.finally(() => receiving.delete(receipt))
    })

  /** Writes everything pending now, e.g. when a tab hides or unloads. */
  const flush = async (): Promise<WriteResult> => {
    await Promise.allSettled(receiving)
    const results = await Promise.all([...pending.keys()].map(flushOne))
    return (
      results.find(result => result && !result.ok) ?? { ok: true as const }
    )
  }

  /**
   * The book's position for the signed-in user. Opening a book with a
   * position makes it the most recent; a miss creates nothing.
   */
  const open = async (bookKey: unknown): Promise<OpenResult> => {
    const userId = await currentUserId()
    if (!userId) return { ok: false, code: 'signed-out' }
    if (typeof bookKey !== 'string') return { ok: true, position: null }
    return serialized(async () => {
      const opened = withOpened(await readBooks(userId), bookKey, now())
      if (!opened) return { ok: true, position: null }
      try {
        await storage.set(storageKeyFor(userId), opened)
      } catch {
        console.warn('Reading position recency not saved: write-failed')
      }
      return { ok: true, position: opened.books[bookKey].position }
    })
  }

  return { record, flush, open }
}

export type ReadingPositionWriter = ReturnType<
  typeof createReadingPositionWriter
>
