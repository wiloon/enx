'use client'

import { useEffect, useState } from 'react'
import { notifySignedIn } from '@/lib/enxExtension'

// Matches SIGNIN_RETURN_HOLD_MS in enx-chrome's background service worker: the
// extension waits this long on this page before closing the tab and switching
// the user back. The countdown below is just the visible half of that wait.
const RETURN_HOLD_SECONDS = 3

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
    notifySignedIn()

    const timer = setInterval(() => {
      setSecondsLeft(s => (s > 0 ? s - 1 : 0))
    }, 1000)
    return () => clearInterval(timer)
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
          If you came here from the ENX extension and this tab doesn&apos;t
          close on its own, you can close it and return to your page — the
          extension is signed in now.
        </p>
      </div>
    </div>
  )
}
