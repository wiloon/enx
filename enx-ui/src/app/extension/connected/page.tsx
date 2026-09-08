'use client'

import { useEffect } from 'react'
import { notifySignedIn } from '@/lib/enxExtension'

// ADR-020: where the web sign-in lands when it was started from the ENX
// extension (`/sign-in?src=extension` sets this as the redirect). It tells the
// extension the sign-in is done; the extension then closes this tab and
// switches the user back to the tab they came from. The copy below is the
// fallback for when that automatic hand-off does not happen (message not
// delivered, a non-Chromium browser, or a plain web visitor who navigated
// here directly).
export default function ExtensionConnectedPage() {
  useEffect(() => {
    notifySignedIn()
  }, [])

  return (
    <div className="flex min-h-screen items-center justify-center p-8">
      <div className="max-w-sm text-center">
        <h1 className="text-xl font-semibold">You&apos;re signed in</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Taking you back to what you were reading…
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
