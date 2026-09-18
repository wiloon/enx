// Reading-stats reporting queue (ADR-028 Decision 5).
//
// The content script measures how much was read; this module is what gets
// that number to the server, and the only part of the extension that knows
// `POST /api/stats/ingest` exists.
//
// Three properties it has to hold:
//
//  1. **Idempotent.** Each report carries a `clientEventId`; the server
//     drops a repeat. That is what makes retrying safe, and it means a
//     retry must reuse the ID it was created with, never mint a new one.
//  2. **Survives worker eviction.** MV3 kills an idle service worker, so the
//     pending queue lives in chrome.storage.local, not in a module variable.
//  3. **Lossy on purpose.** A report that keeps failing is dropped, not
//     retried forever. Statistics must never cost the user anything --
//     not a stuck worker, not unbounded storage, and above all not a wrong
//     number from a double-count.

import type { ApiRequestResult } from './background'

/** Pending reports, oldest first. */
export const STATS_QUEUE_STORAGE_KEY = 'enx-stats-queue'

/**
 * Hard cap on the queue. Reached only if the user reads offline for a long
 * time; past that the oldest reports are dropped, because a user who has
 * been away from the network for days is better served by an approximate
 * recent number than by a backlog that never drains.
 */
export const MAX_QUEUED_REPORTS = 50

/** How many times one report is retried before it is given up on. */
export const MAX_ATTEMPTS = 3

export type StatsDelta = {
  wordsRead?: number
  articlesRead?: number
  wordLookups?: number
  newWords?: number
  wordsMastered?: number
  phraseLookups?: number
  sentenceTranslations?: number
  contextLookups?: number
}

export type QueuedReport = {
  clientEventId: string
  localDate: string
  utcOffsetMinutes: number
  delta: StatsDelta
  attempts: number
}

/**
 * The caller's UTC offset in minutes, in the sign convention the server
 * expects: UTC+8 is +480. JavaScript's getTimezoneOffset() has the opposite
 * sign (UTC+8 reports -480), which is exactly the kind of detail worth
 * naming once instead of negating at three call sites.
 */
export function utcOffsetMinutes(now: Date = new Date()): number {
  return -now.getTimezoneOffset()
}

/** The caller's own calendar day as YYYY-MM-DD -- local, never UTC. */
export function localDate(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function isEmpty(delta: StatsDelta): boolean {
  return Object.values(delta).every((v) => !v || v <= 0)
}

async function readQueue(): Promise<QueuedReport[]> {
  try {
    const stored = await chrome.storage.local.get(STATS_QUEUE_STORAGE_KEY)
    const queue = stored?.[STATS_QUEUE_STORAGE_KEY]
    return Array.isArray(queue) ? (queue as QueuedReport[]) : []
  } catch {
    return []
  }
}

async function writeQueue(queue: QueuedReport[]): Promise<void> {
  try {
    await chrome.storage.local.set({ [STATS_QUEUE_STORAGE_KEY]: queue })
  } catch {
    // Storage is full or unavailable. Nothing to do -- see property 3.
  }
}

/**
 * Adds a report to the queue and tries to drain it.
 *
 * `request` is injected rather than imported so this module can be tested
 * without the Clerk-backed API layer, and so the retry/queue logic stays
 * readable on its own.
 */
export async function enqueueReport(
  delta: StatsDelta,
  request: (endpoint: string, options: RequestInit) => Promise<ApiRequestResult>,
  now: Date = new Date()
): Promise<void> {
  if (isEmpty(delta)) return

  const report: QueuedReport = {
    clientEventId: crypto.randomUUID(),
    localDate: localDate(now),
    utcOffsetMinutes: utcOffsetMinutes(now),
    delta,
    attempts: 0,
  }

  const queue = await readQueue()
  queue.push(report)
  await writeQueue(queue.slice(-MAX_QUEUED_REPORTS))
  await flushQueue(request)
}

/**
 * Sends queued reports oldest-first until one fails transiently.
 *
 * A 4xx means the server will never accept this report (a bad date, a
 * malformed body) -- resending it would just fail again, so it is dropped.
 * Everything else is transient and gets `MAX_ATTEMPTS` tries before it is
 * dropped too. Stopping at the first transient failure keeps reports in
 * order and avoids hammering an API that is plainly down.
 */
export async function flushQueue(
  request: (endpoint: string, options: RequestInit) => Promise<ApiRequestResult>
): Promise<void> {
  let queue = await readQueue()
  if (queue.length === 0) return

  while (queue.length > 0) {
    const report = queue[0]
    const result = await request('/api/stats/ingest', {
      method: 'POST',
      body: JSON.stringify({
        clientEventId: report.clientEventId,
        localDate: report.localDate,
        utcOffsetMinutes: report.utcOffsetMinutes,
        delta: report.delta,
      }),
    })

    if (result.success) {
      queue.shift()
      continue
    }

    const permanent =
      typeof result.status === 'number' &&
      result.status >= 400 &&
      result.status < 500 &&
      result.status !== 429
    if (permanent) {
      console.warn(
        `stats: dropping report ${report.clientEventId} (HTTP ${result.status})`
      )
      queue.shift()
      continue
    }

    report.attempts += 1
    if (report.attempts >= MAX_ATTEMPTS) {
      console.warn(
        `stats: giving up on report ${report.clientEventId} after ${report.attempts} attempts`
      )
      queue.shift()
      continue
    }

    // Transient and still worth retrying: leave it at the head and stop.
    // The next report, or the next worker wake-up, tries again.
    break
  }

  queue = queue.slice(-MAX_QUEUED_REPORTS)
  await writeQueue(queue)
}
