// Service-worker lifecycle + auth diagnostics logging (ADR-015 mitigation).
//
// MV3 gives no reliable signal that the service worker is *about to be* evicted
// or that it was *just* revived from idle:
//   - chrome.runtime.onSuspend / onSuspendCanceled are unreliable for service
//     workers (they were designed for MV2 event pages) -- do not depend on them.
//   - chrome.runtime.onStartup fires only on browser start.
//   - chrome.runtime.onInstalled fires only on install / update.
// The one solid signal is that every cold start re-runs this module's
// top-level code. So we stamp a boot time on import, diff it against the last
// heartbeat we managed to persist before the worker died, and keep a capped
// ring buffer in chrome.storage.local that outlives the worker for post-mortem
// inspection (surfaced via the `debugStorage` / `getSwLog` messages).

// Set once, when the service worker starts (import time). `Date.now() -
// WORKER_BOOTED_AT` is "time since this worker instance woke up" -- a small
// value at the moment an API call fails is a strong hint the failure is a
// cold-start race (Clerk session not synced yet) rather than a real problem.
export const WORKER_BOOTED_AT = Date.now()

const RING_KEY = 'enxSwLog'
const RING_MAX = 150
const LAST_ALIVE_KEY = 'enxSwLastAliveAt'

export type SwLogLevel = 'info' | 'warn' | 'error'
export type SwLogEntry = {
  /** epoch ms */
  t: number
  /** ms since this worker instance booted */
  sinceBootMs: number
  level: SwLogLevel
  msg: string
}

// Serialise ring-buffer writes so overlapping swlog() calls don't clobber each
// other's read-modify-write of the stored array.
let ringWrite: Promise<void> = Promise.resolve()

export const swlog = (msg: string, level: SwLogLevel = 'info'): void => {
  const entry: SwLogEntry = {
    t: Date.now(),
    sinceBootMs: Date.now() - WORKER_BOOTED_AT,
    level,
    msg,
  }

  const line = `[enx-sw +${entry.sinceBootMs}ms] ${msg}`
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)

  ringWrite = ringWrite
    .then(async () => {
      try {
        const stored = await chrome.storage.local.get(RING_KEY)
        const ring: SwLogEntry[] = Array.isArray(stored?.[RING_KEY])
          ? (stored[RING_KEY] as SwLogEntry[])
          : []
        ring.push(entry)
        if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX)
        await chrome.storage.local.set({ [RING_KEY]: ring })
      } catch {
        // Best-effort: logging must never break a request path.
      }
    })
    .catch(() => {})
}

export const readSwLog = async (): Promise<SwLogEntry[]> => {
  try {
    const stored = await chrome.storage.local.get(RING_KEY)
    return Array.isArray(stored?.[RING_KEY])
      ? (stored[RING_KEY] as SwLogEntry[])
      : []
  } catch {
    return []
  }
}

// Bump the "still alive" timestamp in chrome.storage.session (which survives
// worker restarts but not a browser restart). Cheap enough to call on every
// inbound message; an eviction gap then shows up as the delta the next boot
// reports, without needing the "alarms" permission for a real heartbeat.
export const heartbeat = async (): Promise<void> => {
  try {
    await chrome.storage.session.set({ [LAST_ALIVE_KEY]: Date.now() })
  } catch {
    // ignore
  }
}

// Called once from background.ts's module top level.
export const recordWorkerBoot = async (reason = 'cold start'): Promise<void> => {
  let downtimeMs: number | null = null
  try {
    const stored = await chrome.storage.session.get(LAST_ALIVE_KEY)
    const last =
      typeof stored?.[LAST_ALIVE_KEY] === 'number'
        ? (stored[LAST_ALIVE_KEY] as number)
        : null
    if (last !== null) downtimeMs = Math.max(0, Date.now() - last)
  } catch {
    // ignore
  }

  swlog(
    downtimeMs === null
      ? `worker boot (${reason}); no prior heartbeat this browser session`
      : `worker boot (${reason}); worker had been idle/dead ~${Math.round(
          downtimeMs / 1000
        )}s`
  )

  await heartbeat()
}
