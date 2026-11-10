'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { browserName, type BrowserIdentity } from '@/lib/browserName'
import {
  clampFeedbackText,
  feedbackContext,
  feedbackFailureMessage,
  feedbackRemaining,
  isFeedbackBlank,
} from '@/lib/feedback'
import { sanitizePageUrl } from '@/lib/pageUrl'
import { runtimeEnv } from '@/lib/runtimeEnv'
import { apiService } from '@/services/api'

// "Send feedback" from the account menu (ADR-076): the user's own words,
// with the current page's cleaned URL, which they may edit or clear.
// A successful send calls onSent; the caller closes the dialog and thanks
// the user with a toast.
export default function FeedbackDialog({
  onClose,
  onSent,
}: {
  onClose: () => void
  onSent: () => void
}) {
  const [text, setText] = useState('')
  const [url, setUrl] = useState(
    () => sanitizePageUrl(window.location.href) ?? ''
  )
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // State lags a click; the ref stops a second one in the same tick.
  const inFlight = useRef(false)
  const textarea = useRef<HTMLTextAreaElement>(null)

  // After the account menu's focus trap has let go, which autoFocus is not.
  useEffect(() => {
    const id = setTimeout(() => textarea.current?.focus())
    return () => clearTimeout(id)
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const blank = isFeedbackBlank(text)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (inFlight.current || blank) return
    inFlight.current = true
    setPending(true)
    setError(null)
    try {
      const resp = await apiService.submitFeedback({
        text,
        url,
        context: feedbackContext(
          runtimeEnv('ENX_VERSION'),
          browserName(navigator as unknown as BrowserIdentity)
        ),
      })
      if (resp.success) {
        onSent()
      } else {
        setError(feedbackFailureMessage(resp.status, resp.error))
      }
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }

  // Portalled: the top bar's backdrop-blur would otherwise be the containing
  // block of this fixed overlay.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex overflow-y-auto bg-black/50 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-dialog-title"
        className="m-auto w-full max-w-lg space-y-4 rounded-xl border bg-background p-5 shadow-lg"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 id="feedback-dialog-title" className="text-lg font-semibold">
              Send feedback
            </h2>
            <p className="text-sm text-muted-foreground">
              Tell us what went wrong or what could be better.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Close"
            title="Close"
            className="active:scale-[0.97]"
            onClick={onClose}
          >
            <X aria-hidden />
          </Button>
        </div>

        <form className="space-y-3" onSubmit={submit}>
          <Label htmlFor="feedback-text" className="sr-only">
            Your feedback
          </Label>
          <div className="rounded-xl border bg-card shadow-xs focus-within:ring-2 focus-within:ring-ring">
            <textarea
              id="feedback-text"
              ref={textarea}
              value={text}
              onChange={(e) => {
                setText(clampFeedbackText(e.target.value))
              }}
              disabled={pending}
              placeholder="Your feedback"
              className="field-sizing-content max-h-[50vh] min-h-32 w-full resize-none overflow-y-auto border-0 bg-transparent px-3 py-2 text-base outline-none"
            />
            <div className="flex flex-wrap items-center justify-end gap-3 px-3 pb-3">
              <span
                className="text-xs text-muted-foreground"
                aria-live="polite"
              >
                {feedbackRemaining(text).toLocaleString('en-US')} characters
                left
              </span>
              <Button
                className="active:scale-[0.97]"
                variant="brand"
                type="submit"
                disabled={blank || pending}
              >
                {pending ? 'Sending…' : 'Send'}
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="feedback-url">Page URL</Label>
            <Input
              id="feedback-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={pending}
              placeholder="No page"
            />
            <p className="text-xs text-muted-foreground">
              Only the site and path are sent. Clear it to send without a page.
            </p>
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </form>
      </div>
    </div>,
    document.body
  )
}
