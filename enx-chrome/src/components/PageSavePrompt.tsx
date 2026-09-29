// Offered in the popup when the user chooses to save (收藏) the current page
// (ADR-032). It shows exactly what would be saved -- the address as the
// browser has it and the page title -- and saves nothing until the user
// confirms.

export type PageSaveStatus =
  'idle' | 'saving' | 'saved' | 'already-saved' | 'failed'

interface PageSavePromptProps {
  /** The address as the browser has it; enx-api normalizes it on save. */
  url: string
  title: string
  status: PageSaveStatus
  onSave: () => void
  onCancel: () => void
  /** The address enx-api actually stored (normalized), once saved. */
  savedUrl?: string
  /** The server's own message when saving failed. */
  errorMessage?: string
}

export default function PageSavePrompt({
  url,
  title,
  status,
  onSave,
  onCancel,
  savedUrl,
  errorMessage,
}: PageSavePromptProps) {
  if (status === 'saved' || status === 'already-saved') {
    return (
      <div
        role="status"
        className="space-y-1 rounded-lg bg-background px-3 py-2.5 text-xs ring-1 ring-border"
      >
        <p className="font-medium text-foreground">
          {status === 'saved' ? 'Saved' : 'Already saved'}
        </p>
        <p
          data-testid="page-saved-url"
          className="break-all font-mono text-[11px] text-muted-foreground"
        >
          {savedUrl}
        </p>
      </div>
    )
  }

  return (
    <div
      data-testid="page-save-prompt"
      className="space-y-2 rounded-lg bg-background px-3 py-2.5 text-xs ring-1 ring-border"
    >
      <p data-testid="page-save-title" className="font-medium text-foreground">
        {title}
      </p>
      <p
        data-testid="page-save-url"
        className="break-all rounded bg-muted px-2 py-1 font-mono text-[11px] text-foreground"
      >
        {url}
      </p>
      {status === 'failed' && (
        <p role="alert" className="text-destructive">
          {errorMessage || "Couldn't save this page. Try again in a moment."}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={status === 'saving'}
          className="flex-1 rounded-lg bg-brand py-1.5 font-semibold text-brand-foreground transition hover:brightness-105 disabled:opacity-60"
        >
          {status === 'saving' ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={status === 'saving'}
          className="flex-1 rounded-lg bg-muted py-1.5 font-medium text-foreground transition hover:bg-border disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
