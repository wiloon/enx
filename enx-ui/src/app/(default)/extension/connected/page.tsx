'use client'

import { useEffect, useState } from 'react'
import { notifySignedIn } from '@/lib/enxExtension'

// Matches SIGNIN_RETURN_HOLD_MS in enx-chrome's background service worker: the
// extension waits this long on this page before closing the tab and switching
// the user back. The countdown below is just the visible half of that wait.
const RETURN_HOLD_SECONDS = 3

// How long and how often to keep telling the extension "the sign-in is done"
// before giving up. A single fire-and-forget message isn't enough: MV3 evicts
// an idle service worker, and a `enx:signed-in` sent right after a fresh
// Google OAuth round trip can be the event that cold-boots it -- its own
// Clerk resync (background.ts's SESSION_SYNC_RETRY_DELAYS_MS) can still lose
// that race and answer "signed-out" even though the site itself is signed in.
// Retrying gives a cold worker more chances to catch up instead of stranding
// the user on this page.
const NOTIFY_RETRY_BUDGET_MS = 20000
const NOTIFY_RETRY_INTERVAL_MS = 2500

// ADR-020: where the web sign-in lands when it was started from the ENX
// extension (`/sign-in?src=extension` sets this as the redirect). It tells the
// extension the sign-in is done; the extension then closes this tab and
// switches the user back to the tab they came from. The copy below is the
// fallback for when that automatic hand-off does not happen (message not
// delivered, a non-Chromium browser, or a plain web visitor who navigated
// here directly).
export default function ExtensionConnectedPage() {
  const [secondsLeft, setSecondsLeft] = useState(RETURN_HOLD_SECONDS)

  useEffect(() => {
    let cancelled = false
    const startedAt = Date.now()

    const attempt = async () => {
      const result = await notifySignedIn()
      if (cancelled) return

      // Stop once the extension gives a definitive answer: it either
      // confirmed the hand-off (returned: true, tab is closing now) or told
      // us there's nothing to do (already handled, or the record expired).
      // Only retry the transient "haven't synced yet" cases.
      const shouldRetry =
        result === null || (!result.ok && result.reason === 'signed-out')
      if (!shouldRetry) return

      if (Date.now() - startedAt < NOTIFY_RETRY_BUDGET_MS) {
        setTimeout(() => void attempt(), NOTIFY_RETRY_INTERVAL_MS)
      }
    }
    void attempt()

    const timer = setInterval(() => {
      setSecondsLeft((s) => (s > 0 ? s - 1 : 0))
    }, 1000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  return (
    <div className="flex min-h-screen items-center justify-center p-8">
      <div className="max-w-sm text-center">
        <h1 className="text-xl font-semibold">You&apos;re signed in</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {secondsLeft > 0
            ? `The extension is ready. Taking you back to what you were reading in ${secondsLeft}s…`
            : 'The extension is ready. Taking you back to what you were reading…'}
        </p>
        <p className="mt-4 text-xs text-muted-foreground">
          If you came here from the Catglish extension and this tab doesn&apos;t
          close on its own, you can close it and return to your page — the
          extension is signed in now.
        </p>
      </div>
    </div>
  )
}
