// adr-046 Decision 6: learning mode's state lives on the toolbar badge, which
// an unpinned icon hides. Shown briefly in the page's top layer -- never in
// the article -- at most twice, and never again after "Don't show again".

import { useEffect } from 'react'

export const PIN_HINT_DURATION_MS = 8000

interface PinHintProps {
  onClose: () => void
  onDontShowAgain: () => void
  /** Auto-dismiss delay; the caller's onClose runs when it elapses. */
  durationMs?: number
}

export default function PinHint({
  onClose,
  onDontShowAgain,
  durationMs = PIN_HINT_DURATION_MS,
}: PinHintProps) {
  useEffect(() => {
    const timer = setTimeout(onClose, durationMs)
    return () => clearTimeout(timer)
  }, [onClose, durationMs])

  return (
    <div
      role="status"
      data-testid="pin-hint"
      className="flex w-72 items-start gap-2 rounded-lg bg-background px-3 py-2.5 text-xs text-foreground shadow-lg ring-1 ring-border"
    >
      <div className="flex-1 space-y-2">
        <p>Pin Catglish to your toolbar to see when it&apos;s on.</p>
        <button
          type="button"
          onClick={onDontShowAgain}
          className="font-medium text-muted-foreground underline-offset-2 hover:underline"
        >
          {"Don't show again"}
        </button>
      </div>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="text-base leading-none text-muted-foreground hover:text-foreground"
      >
        ×
      </button>
    </div>
  )
}
