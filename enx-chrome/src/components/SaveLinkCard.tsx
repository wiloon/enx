// The popup's save card (ADR-032 Decision 4). It always shows the exact
// address that would be saved, so one click is the whole confirmation; once
// saved, the same card offers Remove. The copy says "link", not "page":
// enx-api keeps the address and title, never the page's content.

import { BookmarkIcon } from '@heroicons/react/24/outline'
import { BookmarkIcon as BookmarkSolidIcon } from '@heroicons/react/24/solid'

interface SaveLinkCardProps {
  /** The address as the browser has it; enx-api normalizes it on save. */
  url: string
  saved: boolean
  busy: 'saving' | 'removing' | null
  error?: string
  /** enx-ui's Saved page, where the whole list is managed. */
  savedListUrl: string
  onSave: () => void
  onRemove: () => void
}

export default function SaveLinkCard({
  url,
  saved,
  busy,
  error,
  savedListUrl,
  onSave,
  onRemove,
}: SaveLinkCardProps) {
  const address = (
    <span
      data-testid="save-link-url"
      title={url}
      className="mt-1 line-clamp-2 block break-all font-mono text-[10.5px] leading-snug text-muted-foreground"
    >
      {url}
    </span>
  )
  const errorLine = error && (
    <p role="alert" className="mt-1.5 text-[11px] text-destructive">
      {error}
    </p>
  )

  if (saved) {
    return (
      <div
        role="status"
        data-testid="save-link-card"
        className="rounded-xl bg-background px-3 py-2.5 shadow-xs ring-1 ring-brand/40"
      >
        <div className="flex items-start gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand text-brand-foreground">
            <BookmarkSolidIcon className="h-[18px] w-[18px]" />
          </span>
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block text-sm font-medium text-foreground">
              Link saved
            </span>
            {address}
            <a
              href={savedListUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="save-link-view-all"
              className="mt-1 inline-block text-[11px] font-medium text-brand hover:underline"
            >
              View all saved links ›
            </a>
          </span>
          <button
            type="button"
            data-testid="save-link-remove"
            onClick={onRemove}
            disabled={busy !== null}
            className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-60"
          >
            {busy === 'removing' ? 'Removing…' : 'Remove'}
          </button>
        </div>
        {errorLine}
      </div>
    )
  }

  return (
    <div>
      <button
        type="button"
        data-testid="save-link-card"
        onClick={onSave}
        disabled={busy !== null}
        className="flex w-full items-start gap-3 rounded-xl bg-background px-3 py-2.5 text-left shadow-xs ring-1 ring-border transition hover:ring-brand/50 disabled:opacity-60"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-muted text-brand">
          <BookmarkIcon className="h-[18px] w-[18px]" />
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block text-sm font-medium text-foreground">
            {busy === 'saving' ? 'Saving…' : 'Save link'}
          </span>
          <span className="block text-[11px] text-muted-foreground">
            Saves the link and title, not the page content
          </span>
          {address}
        </span>
      </button>
      {errorLine}
    </div>
  )
}
