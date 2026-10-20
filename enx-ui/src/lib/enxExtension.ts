// ADR-019: the enx-ui side of the one web -> extension channel. The Reader
// page renders pasted text; the ENX Chrome extension does the click-to-lookup
// (exactly as on any article site). These helpers detect whether that
// extension is installed and ask it to enable learning mode on the Reader tab.

import { runtimeEnv } from './runtimeEnv'

// Set once the extension is packed / published. Empty in local dev, which
// makes every helper below a no-op (treated as "not installed").
export function extensionId(): string {
  return runtimeEnv('ENX_EXTENSION_ID')
}

export function webStoreUrl(): string {
  return runtimeEnv('ENX_EXTENSION_WEB_STORE_URL')
}

// The extension runs only in Chromium browsers (Chrome, Edge, ...), whose
// user agents all carry "Chrome/". /welcome tells everyone else up front.
export function isChromium(userAgent: string): boolean {
  return /\bChrome\//.test(userAgent)
}

type ExternalRuntime = {
  sendMessage?: (
    extensionId: string,
    message: unknown,
    callback: (response: unknown) => void
  ) => void
  lastError?: unknown
}

function runtime(): ExternalRuntime | undefined {
  return (globalThis as { chrome?: { runtime?: ExternalRuntime } }).chrome
    ?.runtime
}

// One round-trip to the extension. Resolves `fallback` when there is no
// messaging bridge, the extension does not answer or reports an error, or
// the call times out; otherwise the parsed response.
function sendExternal<T>(
  type: string,
  parse: (response: object) => T,
  fallback: T,
  timeoutMs: number
): Promise<T> {
  const rt = runtime()
  const id = extensionId()
  const send = rt?.sendMessage
  if (!id || !send) return Promise.resolve(fallback)

  return new Promise<T>((resolve) => {
    let settled = false
    const done = (result: T) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const timer = setTimeout(() => done(fallback), timeoutMs)

    try {
      send(id, { type }, (response) => {
        if (rt?.lastError || !response || typeof response !== 'object') {
          return done(fallback)
        }
        done(parse(response))
      })
    } catch {
      done(fallback)
    }
  })
}

export type PingResult = { installed: boolean; version?: string }

// Round-trips `enx:ping` through the extension.
export function pingExtension(timeoutMs = 2000): Promise<PingResult> {
  return sendExternal<PingResult>(
    'enx:ping',
    (response) => {
      const r = response as { ok?: boolean; version?: string }
      return { installed: r.ok === true, version: r.version }
    },
    { installed: false },
    timeoutMs
  )
}

export type StatusResult = {
  installed: boolean
  version?: string
  isOnToolbar: boolean
}

// ADR-047 Decision 4: `enx:status` is `enx:ping` plus whether the toolbar
// icon is pinned, which only the extension can read. /welcome polls it.
export function extensionStatus(timeoutMs = 2000): Promise<StatusResult> {
  return sendExternal<StatusResult>(
    'enx:status',
    (response) => {
      const r = response as {
        ok?: boolean
        version?: string
        isOnToolbar?: boolean
      }
      return {
        installed: r.ok === true,
        version: r.version,
        isOnToolbar: r.isOnToolbar === true,
      }
    },
    { installed: false, isOnToolbar: false },
    timeoutMs
  )
}

// Fast path first: the content script stamps the running version onto <html>
// on enx-ui pages (ADR-019 Option G2), which skips the ping round-trip. The
// stamp can land after the page mounts, so an absent stamp falls back to the
// ping rather than meaning "not installed".
export function detectExtension(): Promise<PingResult> {
  const stamped =
    typeof document !== 'undefined'
      ? document.documentElement.dataset.enxExtension
      : undefined
  return stamped
    ? Promise.resolve({ installed: true, version: stamped })
    : pingExtension()
}

// Fire-and-forget: ask the extension to run learning mode on the current tab.
// Safe to call when the extension is absent.
export function requestReaderMode(): void {
  const rt = runtime()
  const id = extensionId()
  const send = rt?.sendMessage
  if (!id || !send) return
  try {
    send(id, { type: 'enx:enable-reader' }, () => void rt?.lastError)
  } catch {
    // no-op
  }
}

export type SignedInReturnResult = {
  ok: boolean
  reason?: string
  returned?: boolean
}

// ADR-020: the /extension/connected page tells the extension a web sign-in
// just completed, so the extension can close this tab and switch the user
// back to the tab they came from. Resolves the extension's response, or null
// when there is no messaging bridge, the extension doesn't answer, or the
// call times out -- a no-op case the caller can retry (a cold MV3 service
// worker can take a few seconds to wake up and resync the Clerk session, see
// background.ts's SESSION_SYNC_RETRY_DELAYS_MS) or ignore (a plain web
// visitor lands here harmlessly).
export function notifySignedIn(
  timeoutMs = 4000
): Promise<SignedInReturnResult | null> {
  return sendExternal<SignedInReturnResult | null>(
    'enx:signed-in',
    (response) => response as SignedInReturnResult,
    null,
    timeoutMs
  )
}
