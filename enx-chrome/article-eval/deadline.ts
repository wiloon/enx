import type { BrowserContext, CDPSession, Page } from '@playwright/test'

// Budgets for browser operations that can hang: a probe that never returns
// keeps its page, and its context's close, waiting forever.

/** Per-page budget for loading, probing and closing. */
export const PAGE_TIMEOUT_MS = 30_000

export class TimeoutError extends Error {}

/**
 * Settles as `work` does, or rejects with "<what> timed out after <ms> ms".
 * Abandoned work may still reject later; the race has already handled it.
 */
export function withDeadline<T>(
  work: Promise<T>,
  ms: number,
  what: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new TimeoutError(`${what} timed out after ${ms} ms`)),
      ms
    )
  })
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer))
}

/** Returns within `ms`; a close that fails or never settles is abandoned. */
export async function closeWithin(
  close: () => Promise<void>,
  ms: number
): Promise<void> {
  await withDeadline(Promise.resolve().then(close), ms, 'close').catch(
    () => undefined
  )
}

// Attach before a probe can block the renderer: attaching afterwards can hang too.
const probeSessions = new WeakMap<BrowserContext, Set<CDPSession>>()

export async function prepareProbe(page: Page): Promise<void> {
  const context = page.context()
  const sessions = probeSessions.get(context) ?? new Set<CDPSession>()
  probeSessions.set(context, sessions)
  sessions.add(await context.newCDPSession(page))
}

/** Stop disposable probe renderers before closing their context, even in a JS loop. */
export async function closeContextWithin(
  context: BrowserContext,
  ms: number
): Promise<void> {
  await closeWithin(async () => {
    for (const session of probeSessions.get(context) ?? []) {
      // Page.crash may never reply. Context closure detaches the session.
      void session.send('Page.crash').catch(() => undefined)
    }
    await context.close()
    probeSessions.delete(context)
  }, ms)
}
