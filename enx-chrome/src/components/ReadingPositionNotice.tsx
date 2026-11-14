// A one-line note about the reading position (#897): its sentence could not
// be found, or it could not be saved. Goes by itself after a while.

import { useEffect } from 'react'

export const READING_POSITION_NOTICE_MS = 8000

const CLOSE_CLASS =
  'rounded-sm text-base leading-none opacity-70 transition hover:opacity-100 active:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand'

interface ReadingPositionNoticeProps {
  text: string
  /** A failure is red; a warning is amber. */
  tone: 'failure' | 'warning'
  onClose: () => void
  durationMs?: number
}

export default function ReadingPositionNotice({
  text,
  tone,
  onClose,
  durationMs = READING_POSITION_NOTICE_MS,
}: ReadingPositionNoticeProps) {
  useEffect(() => {
    const timer = setTimeout(onClose, durationMs)
    return () => clearTimeout(timer)
  }, [onClose, durationMs])

  return (
    <div
      role="status"
      data-testid="reading-position-notice"
      data-tone={tone}
      className={`flex w-72 items-start gap-2 rounded-lg border px-3 py-2.5 text-xs shadow-lg ${
        tone === 'failure'
          ? 'border-destructive/25 bg-destructive/10 text-destructive'
          : 'border-warning bg-warning-muted text-warning-foreground'
      }`}
    >
      <p className="flex-1">{text}</p>
      <button
        type="button"
        aria-label="Close"
        title="Close"
        onClick={onClose}
        className={CLOSE_CLASS}
      >
        ×
      </button>
    </div>
  )
}
