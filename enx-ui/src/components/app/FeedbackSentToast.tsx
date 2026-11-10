'use client'

import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { CircleCheck } from 'lucide-react'
import { FEEDBACK_SENT_MESSAGE } from '@/lib/feedback'

// How long the toast stays on screen.
export const FEEDBACK_TOAST_MS = 3_000

// Thanks the user after "Send feedback" (ADR-076), then goes away by itself.
// Portalled for the same reason as FeedbackDialog: the top bar's
// backdrop-blur would be the containing block of a fixed element.
export default function FeedbackSentToast({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const id = setTimeout(onDone, FEEDBACK_TOAST_MS)
    return () => clearTimeout(id)
  }, [onDone])

  return createPortal(
    <div
      role="status"
      className="fixed inset-x-4 bottom-4 z-50 flex items-center gap-2 rounded-xl bg-foreground px-4 py-3 text-sm font-medium text-background shadow-lg sm:inset-x-auto sm:right-6 sm:bottom-6"
    >
      <CircleCheck aria-hidden className="size-4 shrink-0 text-brand" />
      {FEEDBACK_SENT_MESSAGE}
    </div>,
    document.body
  )
}
