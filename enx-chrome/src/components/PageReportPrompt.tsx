// Offered in the popup after learning mode fails on a page we could not
// read (ADR-010 Decision 8). It shows the user exactly what would be sent and
// sends nothing until they press the button.

export type PageReportStatus = 'idle' | 'sending' | 'sent' | 'failed'

interface PageReportPromptProps {
  /** The sanitized URL -- exactly what will be sent. */
  url: string
  status: PageReportStatus
  onSend: () => void
  onDismiss: () => void
}

export default function PageReportPrompt({
  url,
  status,
  onSend,
  onDismiss,
}: PageReportPromptProps) {
  if (status === 'sent') {
    return (
      <p
        role="status"
        className="rounded-lg bg-background px-3 py-2 text-xs text-foreground ring-1 ring-border"
      >
        Thanks — report sent. We&apos;ll look at this page.
      </p>
    )
  }

  return (
    <div
      data-testid="page-report-prompt"
      className="space-y-2 rounded-lg bg-background px-3 py-2.5 text-xs ring-1 ring-border"
    >
      <p className="font-medium text-foreground">Help us support this page?</p>
      <p className="text-muted-foreground">
        We can send this page&apos;s address to the Catglish team so we can fix
        it. Only the address below is sent — no page content and no reading
        history.
      </p>
      <p
        data-testid="page-report-url"
        className="break-all rounded bg-muted px-2 py-1 font-mono text-[11px] text-foreground"
      >
        {url}
      </p>
      {status === 'failed' && (
        <p role="alert" className="text-destructive">
          Couldn&apos;t send the report. Try again in a moment.
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onSend}
          disabled={status === 'sending'}
          className="flex-1 rounded-lg bg-brand py-1.5 font-semibold text-brand-foreground transition hover:brightness-105 disabled:opacity-60"
        >
          {status === 'sending' ? 'Sending…' : 'Send report'}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          disabled={status === 'sending'}
          className="flex-1 rounded-lg bg-muted py-1.5 font-medium text-foreground transition hover:bg-border disabled:opacity-60"
        >
          No thanks
        </button>
      </div>
    </div>
  )
}
