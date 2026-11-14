// ADR-081 Decision 3: the way back to the last sentence of a book, in the
// page's bottom-right corner, away from the top-right pin hint.

interface ReadingPositionPromptProps {
  /** The start of the last sentence. */
  preview: string
  onJump: () => void
  onDismiss: () => void
}

export default function ReadingPositionPrompt({
  preview,
  onJump,
  onDismiss,
}: ReadingPositionPromptProps) {
  return (
    <div
      role="status"
      data-testid="reading-position-prompt"
      className="flex w-72 items-start gap-2 rounded-lg border-l-4 border-brand bg-background px-3 py-2.5 text-xs text-foreground shadow-lg ring-1 ring-border"
    >
      <button
        type="button"
        onClick={onJump}
        className="flex-1 space-y-1 rounded-sm text-left transition hover:bg-brand-muted active:opacity-70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <span className="block font-medium text-brand">Continue reading</span>
        <span className="block text-muted-foreground">
          &ldquo;{preview}&rdquo;
        </span>
      </button>
      <button
        type="button"
        aria-label="Dismiss"
        title="Dismiss"
        onClick={onDismiss}
        className="rounded-sm text-base leading-none text-muted-foreground transition hover:text-foreground active:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        ×
      </button>
    </div>
  )
}
