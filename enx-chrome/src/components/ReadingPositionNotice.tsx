// A one-line note about the reading position (#897): its sentence could not
// be found, or it could not be saved. Goes by itself after a while.

import { useEffect } from 'react'

export const READING_POSITION_NOTICE_MS = 8000

interface ReadingPositionNoticeProps {
  text: string
  onClose: () => void
  durationMs?: number
}

export default function ReadingPositionNotice({
  text,
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
      className="flex w-72 items-start gap-2 rounded-lg bg-background px-3 py-2.5 text-xs text-foreground shadow-lg ring-1 ring-border"
    >
      <p className="flex-1">{text}</p>
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
