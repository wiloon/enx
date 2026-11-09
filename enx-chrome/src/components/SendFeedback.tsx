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
import {
  ChatBubbleLeftEllipsisIcon,
  ChevronDownIcon,
} from '@heroicons/react/24/outline'
import { useEffect, useId, useRef, useState } from 'react'

// "Send feedback" in the popup (ADR-076): the user's own words, with the
// current tab's cleaned URL, which they may edit or clear.
export default function SendFeedback() {
  const [open, setOpen] = useState(false)
  const [tabId, setTabId] = useState<number>()
  const [defaultUrl, setDefaultUrl] = useState('')
  const [text, setText] = useState('')
  const [url, setUrl] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const [sent, setSent] = useState(false)
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

  const blank = isFeedbackBlank(text)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (inFlight.current || blank) return
    inFlight.current = true
    setPending(true)
    setError(undefined)
    setSent(false)
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
        setSent(true)
        setText('')
        setUrl(defaultUrl)
      } else {
        setError(outcome.message)
      }
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }

  return (
    <div className="rounded-xl bg-background shadow-xs ring-1 ring-border">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-muted/50 active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-muted text-brand">
          <ChatBubbleLeftEllipsisIcon className="h-[18px] w-[18px]" />
        </span>
        <span className="flex-1 text-sm font-medium text-foreground">
          Send feedback
        </span>
        <ChevronDownIcon
          className={`h-4 w-4 text-muted-foreground transition ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <form className="space-y-2.5 px-3 pb-3" onSubmit={submit}>
          <div className="rounded-xl border border-border bg-card shadow-xs focus-within:ring-2 focus-within:ring-brand">
            <textarea
              aria-label="Your feedback"
              value={text}
              onChange={e => {
                setText(clampFeedbackText(e.target.value))
                setSent(false)
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

          {sent && (
            <p role="status" className="text-xs text-brand">
              {FEEDBACK_SENT_MESSAGE}
            </p>
          )}
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </form>
      )}
    </div>
  )
}
