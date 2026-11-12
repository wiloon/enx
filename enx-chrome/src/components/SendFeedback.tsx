import { browserName, type BrowserIdentity } from '@/lib/browserName'
import { getFeedbackContextOnTab } from '@/lib/enableLearningMode'
import {
  FEEDBACK_SENT_MESSAGE,
  clampFeedbackText,
  feedbackRemaining,
  isFeedbackBlank,
  sendFeedback,
} from '@/lib/feedback'
import { sanitizePageUrl } from '@/lib/pageReport'
import { ArrowLeftIcon, CheckCircleIcon } from '@heroicons/react/24/outline'
import { type ReactNode, useEffect, useId, useRef, useState } from 'react'

// How long the "feedback sent" toast stays on screen.
export const FEEDBACK_TOAST_MS = 3_000

// "Send feedback" in the popup (ADR-076): the user's own words, with the
// current tab's cleaned URL, which they may edit or clear. The form is a page
// of its own in place of the popup's main page (`children`), so the popup
// stays within Chrome's 600px height; a successful send returns to the main
// page and shows a toast that goes away by itself.
export default function SendFeedback({
  children,
  footerEnd,
}: {
  children?: ReactNode
  footerEnd?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [toast, setToast] = useState(false)
  const [tabId, setTabId] = useState<number>()
  const [defaultUrl, setDefaultUrl] = useState('')
  const [text, setText] = useState('')
  const [url, setUrl] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  // State lags a click; the ref stops a second one in the same tick.
  const inFlight = useRef(false)
  const urlId = useId()

  // The tab is read once, on the first open; later opens keep what the user
  // typed (or cleared). A URL edited before the query resolves also wins.
  const queried = useRef(false)
  const urlEdited = useRef(false)

  useEffect(() => {
    if (!open || queried.current) return
    queried.current = true
    chrome.tabs
      .query({ active: true, currentWindow: true })
      .then(([tab]) => {
        const cleaned = sanitizePageUrl(tab?.url) ?? ''
        setTabId(tab?.id)
        setDefaultUrl(cleaned)
        if (!urlEdited.current) setUrl(cleaned)
      })
      .catch(() => {})
  }, [open])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(false), FEEDBACK_TOAST_MS)
    return () => clearTimeout(timer)
  }, [toast])

  const blank = isFeedbackBlank(text)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (inFlight.current || blank) return
    inFlight.current = true
    setPending(true)
    setError(undefined)
    try {
      const page =
        tabId === undefined
          ? { learningMode: false }
          : await getFeedbackContextOnTab(tabId)
      const outcome = await sendFeedback(
        message => chrome.runtime.sendMessage(message),
        {
          text,
          url,
          context: {
            browser: browserName(navigator as unknown as BrowserIdentity),
            ...page,
          },
        }
      )
      if (outcome.sent) {
        setText('')
        setUrl(defaultUrl)
        setOpen(false)
        setToast(true)
      } else {
        setError(outcome.message)
      }
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }

  if (open) {
    return (
      <div className="space-y-2.5 p-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Back"
            onClick={() => setOpen(false)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-background hover:text-foreground active:scale-[0.95] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            <ArrowLeftIcon className="h-[18px] w-[18px]" />
          </button>
          <h2 className="text-sm font-semibold text-foreground">
            Send feedback
          </h2>
        </div>
        <form className="space-y-2.5" onSubmit={submit}>
          <div className="rounded-xl border border-border bg-card shadow-xs focus-within:ring-2 focus-within:ring-brand">
            <textarea
              aria-label="Your feedback"
              autoFocus
              value={text}
              onChange={e => {
                setText(clampFeedbackText(e.target.value))
              }}
              disabled={pending}
              placeholder="Tell us what went wrong or what could be better."
              className="field-sizing-content block max-h-48 min-h-20 w-full resize-none overflow-y-auto border-0 bg-transparent px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
            <div className="flex items-center justify-end gap-3 px-3 pb-2">
              <span
                className="text-[11px] text-muted-foreground"
                aria-live="polite"
              >
                {feedbackRemaining(text).toLocaleString('en-US')} characters
                left
              </span>
              <button
                type="submit"
                disabled={blank || pending}
                className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground transition hover:bg-brand/90 active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>

          <div className="space-y-1">
            <label
              htmlFor={urlId}
              className="block text-xs font-medium text-foreground"
            >
              Page URL
            </label>
            <input
              id={urlId}
              type="text"
              value={url}
              onChange={e => {
                urlEdited.current = true
                setUrl(e.target.value)
              }}
              disabled={pending}
              placeholder="No page"
              className="block w-full rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-brand"
            />
            <p className="text-[11px] text-muted-foreground">
              Only the site and path are sent. Clear it to send without a page.
            </p>
          </div>

          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </form>
      </div>
    )
  }

  return (
    <div className="p-3 pb-2">
      {toast && (
        <div
          role="status"
          className="fixed inset-x-3 top-3 z-50 flex items-center gap-2 rounded-xl bg-foreground px-3 py-2.5 text-sm font-medium text-background shadow-lg"
        >
          <CheckCircleIcon className="h-[18px] w-[18px] shrink-0 text-brand" />
          {FEEDBACK_SENT_MESSAGE}
        </div>
      )}
      <div className="space-y-2.5">{children}</div>
      {/* A quiet ghost entry rather than a card of its own, so the main page
          fits Chrome's 600px popup without a scrollbar. */}
      <div className="mt-1 flex items-center justify-center">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded px-1.5 py-0.5 text-xs font-medium text-muted-foreground transition hover:bg-background hover:text-foreground active:bg-background/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          Send feedback
        </button>
        {footerEnd && (
          <>
            {/* Button padding supplies the 6px each side of the dot. */}
            <span
              aria-hidden="true"
              className="text-xs text-muted-foreground/60"
            >
              ·
            </span>
            {footerEnd}
          </>
        )}
      </div>
    </div>
  )
}
