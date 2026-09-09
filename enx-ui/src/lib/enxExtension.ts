// ADR-019: the enx-ui side of the one web -> extension channel. The Reader
// page renders pasted text; the ENX Chrome extension does the click-to-lookup
// (exactly as on any article site). These helpers detect whether that
// extension is installed and ask it to enable learning mode on the Reader tab.

// Set once the extension is packed / published. Empty in local dev, which
// makes every helper below a no-op (treated as "not installed").
export function extensionId(): string {
  return process.env.NEXT_PUBLIC_ENX_EXTENSION_ID ?? ''
}

export function webStoreUrl(): string {
  return process.env.NEXT_PUBLIC_ENX_EXTENSION_WEB_STORE_URL ?? ''
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
  return (globalThis as { chrome?: { runtime?: ExternalRuntime } }).chrome?.runtime
}

export type PingResult = { installed: boolean; version?: string }

// Round-trips `enx:ping` through the extension. Resolves { installed: false }
// when there is no messaging bridge, the extension does not answer, or the
// call times out.
export function pingExtension(timeoutMs = 2000): Promise<PingResult> {
  const rt = runtime()
  const id = extensionId()
  const send = rt?.sendMessage
  if (!id || !send) return Promise.resolve({ installed: false })

  return new Promise<PingResult>(resolve => {
    let settled = false
    const done = (result: PingResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const timer = setTimeout(() => done({ installed: false }), timeoutMs)

    try {
      send(id, { type: 'enx:ping' }, response => {
        if (rt?.lastError || !response || typeof response !== 'object') {
          return done({ installed: false })
        }
        const r = response as { ok?: boolean; version?: string }
        done({ installed: r.ok === true, version: r.version })
      })
    } catch {
      done({ installed: false })
    }
  })
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

// ADR-020: the /extension/connected page tells the extension a web sign-in
// just completed, so the extension can close this tab and switch the user
// back to the tab they came from. Fire-and-forget; a no-op when the
// extension is absent (a plain web visitor lands here harmlessly).
export function notifySignedIn(): void {
  const rt = runtime()
  const id = extensionId()
  const send = rt?.sendMessage
  if (!id || !send) return
  try {
    send(id, { type: 'enx:signed-in' }, () => void rt?.lastError)
  } catch {
    // no-op
  }
}
