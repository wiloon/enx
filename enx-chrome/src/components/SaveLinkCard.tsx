// The popup's save card (ADR-032 Decision 4). It always shows the exact
// address that would be saved, so one click on Save is the whole
// confirmation; once saved, the same card offers Remove. The address sits on
// one line, cut with an ellipsis, and shows in full in a tooltip when the
// pointer is anywhere on that line or it has keyboard focus. Not the native
// title: Chrome's popup only shows that over the ellipsis. Save is a
// filled button of its own, so the card reads as an action, not a label. The copy says "link", not "page":
// enx-api keeps the address and title, never the page's content.

import { BookmarkIcon } from '@heroicons/react/24/outline'
import { BookmarkIcon as BookmarkSolidIcon } from '@heroicons/react/24/solid'
import { useId } from 'react'

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
  const tooltipId = useId()
  // The tooltip is placed against the card (the nearest `relative`), above
  // it, so it gets the card's full width and never runs off the popup's
  // bottom edge: the card is the last thing in the popup body.
  const address = (
    <>
      <span
        data-testid="save-link-url"
        tabIndex={0}
        aria-describedby={tooltipId}
        className="peer mt-0.5 block cursor-default truncate rounded-sm font-mono text-[10.5px] leading-snug text-muted-foreground outline-none focus-visible:ring-1 focus-visible:ring-brand"
      >
        {url}
      </span>
      <span
        id={tooltipId}
        role="tooltip"
        className="pointer-events-none invisible absolute inset-x-0 bottom-full z-20 mb-1.5 max-h-40 overflow-hidden break-all rounded-lg bg-foreground px-2.5 py-1.5 font-mono text-[10.5px] leading-snug text-background opacity-0 shadow-md transition-opacity delay-150 peer-hover:visible peer-hover:opacity-100 peer-focus-visible:visible peer-focus-visible:opacity-100"
      >
        {url}
      </span>
    </>
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
        className="relative rounded-xl bg-background px-3 py-2.5 shadow-xs ring-1 ring-brand/40"
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
    <div
      data-testid="save-link-card"
      className="relative rounded-xl bg-background px-3 py-2.5 shadow-xs ring-1 ring-border"
    >
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-muted text-brand">
          <BookmarkIcon className="h-[18px] w-[18px]" />
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block text-sm font-medium text-foreground">
            Save this link
          </span>
          <span className="block text-[11px] text-muted-foreground">
            Link and title only, not the page content
          </span>
          {address}
        </span>
        <button
          type="button"
          data-testid="save-link-save"
          onClick={onSave}
          disabled={busy !== null}
          className="flex shrink-0 items-center gap-1 rounded-lg bg-brand px-2.5 py-1.5 text-xs font-semibold text-brand-foreground shadow-sm shadow-brand/25 transition hover:brightness-105 active:scale-[0.97] disabled:opacity-60"
        >
          <BookmarkSolidIcon className="h-3.5 w-3.5" />
          {busy === 'saving' ? 'Saving…' : 'Save'}
        </button>
      </div>
      {errorLine}
    </div>
  )
}
