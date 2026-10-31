'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FileText, Pencil, Puzzle, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { requestReaderMode, webStoreUrl } from '@/lib/enxExtension'
import { useExtensionStatus } from '@/hooks/useExtensionStatus'
import { apiService } from '@/services/api'
import { consumeReaderDocument } from '@/lib/readerSession'
import { MAX_CONTENT_LENGTH } from './constants'
import { toParagraphs } from '@/lib/readerText'
import SegmentedControl from '@/components/app/stats/SegmentedControl'
import { cn } from '@/lib/utils'
import {
  DEFAULT_READER_WIDTH,
  READER_WIDTHS,
  type ReaderWidth,
  loadReaderWidth,
  readerWidthClass,
  saveReaderWidth,
} from './width'
import PageHeader from '@/components/app/PageHeader'

const RECENT_LIMIT = 3

const HOW_IT_WORKS = [
  'Copy text from anywhere',
  'Paste it below',
  'Click a word or sentence',
]

export default function ReaderPage() {
  const [draft, setDraft] = useState('')
  const [article, setArticle] = useState<string | null>(null)
  // The saved document this reading session is backed by, if any. Set after
  // the first successful save (create or open-from-history). While set,
  // submitting again updates this same document (PUT) instead of creating a
  // new one -- that's what makes "Edit text" actually mean "edit", per the
  // ADR-022 Addendum. "New" clears it to start a genuinely separate document.
  const [documentId, setDocumentId] = useState<string | null>(null)
  // Bumped on every submit so re-reading the same text still re-triggers the
  // extension (state value alone wouldn't change).
  const [readSeq, setReadSeq] = useState(0)
  const [promptDismissed, setPromptDismissed] = useState(false)
  const [saveStatus, setSaveStatus] = useState<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle')
  const [width, setWidth] = useState<ReaderWidth>(DEFAULT_READER_WIDTH)
  const extensionStatus = useExtensionStatus()
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)
  const queryClient = useQueryClient()

  // Shares the My Documents page's cache, so a delete there shows up here.
  const recent = useQuery({
    queryKey: ['reader-documents'],
    queryFn: async () => {
      const resp = await apiService.listReaderDocuments()
      if (resp.success && resp.data) return resp.data.documents
      throw new Error(resp.error || 'Failed to load documents')
    },
  })

  // Restore the remembered width after mount; reading localStorage during
  // render would mismatch the server-rendered default.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWidth(loadReaderWidth())
  }, [])

  const handleWidthChange = (next: ReaderWidth) => {
    setWidth(next)
    saveReaderWidth(next)
  }

  const containerClass = cn('mx-auto w-full p-6', readerWidthClass(width))

  const paragraphs = useMemo(
    () => (article ? toParagraphs(article) : []),
    [article]
  )

  const canRead = draft.trim().length > 0 && draft.length <= MAX_CONTENT_LENGTH

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canRead) return
    setArticle(draft)
    setReadSeq((n) => n + 1)
    setSaveStatus('saving')
    const request = documentId
      ? apiService.updateReaderDocument(documentId, draft)
      : apiService.createReaderDocument(draft)
    request.then((resp) => {
      setSaveStatus(resp.success ? 'saved' : 'error')
      if (!resp.success) return
      if (resp.data) setDocumentId(resp.data.id)
      // The server may also have evicted the oldest document at the cap, so
      // the list is refetched rather than patched.
      queryClient.invalidateQueries({ queryKey: ['reader-documents'] })
    })
  }

  // Starts a genuinely new document: distinct from "Edit text", which keeps
  // editing the one this session is backed by.
  const handleNew = () => {
    setDraft('')
    setArticle(null)
    setDocumentId(null)
    setSaveStatus('idle')
  }

  // A document from the Recent list: already saved, so open it like the My
  // Documents hand-off does -- render it and keep its id for later edits.
  const handleOpenRecent = async (id: string) => {
    setOpenError(null)
    setOpeningId(id)
    const resp = await apiService.getReaderDocument(id)
    setOpeningId(null)
    if (!resp.success || !resp.data) {
      setOpenError(resp.error || 'Failed to open document')
      return
    }
    setDraft(resp.data.content)
    setDocumentId(resp.data.id)
    setSaveStatus('saved')
    setArticle(resp.data.content)
    setReadSeq((n) => n + 1)
  }

  // Reopening a document from "My Documents" (history page): it's already
  // persisted, so this just renders it -- no POST. Its id is remembered so a
  // later "Edit text" + Read updates this document instead of creating one.
  useEffect(() => {
    const parsed = consumeReaderDocument()
    if (parsed?.content) {
      // consumeReaderDocument() removes the hand-off from sessionStorage, so it
      // cannot run in a state initializer (StrictMode calls those twice, and
      // the server render has no sessionStorage). One-shot, on mount only.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDraft(parsed.content)
      setDocumentId(parsed.id ?? null)
      setSaveStatus('saved')
      setArticle(parsed.content)
      setReadSeq((n) => n + 1)
    }
    // Only ever relevant right after navigating in from a document list.
  }, [])

  // Once the article is on the page, ask the ENX extension to enable learning
  // mode on this tab (ADR-019). No-op when the extension is absent.
  useEffect(() => {
    if (readSeq > 0) requestReaderMode()
  }, [readSeq])

  if (article !== null) {
    const showInstallPrompt =
      extensionStatus === 'not-installed' && !promptDismissed
    const storeUrl = webStoreUrl()

    return (
      <div className={cn(containerClass, 'space-y-4')}>
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/40 px-4 py-2.5">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-muted-foreground">
              Reading mode
            </span>
            <span
              className={cn(
                'text-xs',
                saveStatus === 'error'
                  ? 'text-destructive'
                  : 'text-muted-foreground'
              )}
              role="status"
            >
              {saveStatus === 'saving' && 'Saving…'}
              {saveStatus === 'saved' && 'Saved · kept for 7 days'}
              {saveStatus === 'error' && "Couldn't save (still readable)"}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <SegmentedControl
              name="reader-width"
              label="Reading width"
              value={width}
              options={READER_WIDTHS.map((w) => ({
                value: w.value,
                label: w.label,
                title: w.hint,
              }))}
              onChange={handleWidthChange}
            />
            <Link
              href="/reader/history"
              className="rounded-sm text-sm font-medium text-brand underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring active:opacity-70"
            >
              My Documents
            </Link>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleNew}
            >
              New
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setArticle(null)}
            >
              <Pencil aria-hidden="true" />
              Edit text
            </Button>
          </div>
        </div>
        {showInstallPrompt && (
          <div className="flex items-start justify-between gap-4 rounded-md border border-warning bg-warning-muted p-3 text-sm text-warning-foreground">
            <p>
              {storeUrl ? (
                <a
                  href={storeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-sm font-medium underline outline-none focus-visible:ring-2 focus-visible:ring-ring active:opacity-70"
                >
                  Install the Catglish extension
                </a>
              ) : (
                <span className="font-medium">
                  Install the Catglish extension
                </span>
              )}{' '}
              to click any word on this page for its definition.
            </p>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => setPromptDismissed(true)}
              className="rounded-sm px-1 opacity-70 outline-none hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring active:opacity-50"
            >
              ×
            </button>
          </div>
        )}
        <article
          id="enx-reader-article"
          className="prose max-w-none whitespace-pre-wrap text-[17px] leading-7"
        >
          {paragraphs.map((p, i) => (
            <p key={i} className="mb-4">
              {p}
            </p>
          ))}
        </article>
      </div>
    )
  }

  // The paste screen keeps one width of its own: the reading-width setting
  // is for the article, not for this form.
  const recentDocuments = recent.data?.slice(0, RECENT_LIMIT) ?? []
  const storeUrl = webStoreUrl()
  const nearLimit = draft.length >= MAX_CONTENT_LENGTH * 0.9

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-6 md:p-8">
      <PageHeader
        title="Reader"
        description="For English text you can't look up where it is: an AI chat reply, a PDF, or a site where the extension doesn't work well. Paste it here and read it with Catglish."
      />

      <ol className="grid gap-3 text-sm sm:grid-cols-3">
        {HOW_IT_WORKS.map((step, i) => (
          <li key={step} className="flex items-start gap-2">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-brand/10 text-xs font-medium text-brand">
              {i + 1}
            </span>
            <span className="text-muted-foreground">{step}</span>
          </li>
        ))}
      </ol>

      {extensionStatus === 'not-installed' && (
        <div
          role="note"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning bg-warning-muted px-4 py-3 text-sm text-warning-foreground"
        >
          <p className="flex items-start gap-2">
            <Puzzle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              Reader needs the Catglish Chrome extension. Without it, the text
              shows up here but you can&apos;t click words to translate them.
            </span>
          </p>
          {storeUrl && (
            <Button asChild size="sm" variant="outline">
              <a href={storeUrl} target="_blank" rel="noopener noreferrer">
                Install the extension
              </a>
            </Button>
          )}
        </div>
      )}

      <form
        className="rounded-xl border bg-card shadow-xs focus-within:ring-2 focus-within:ring-ring"
        onSubmit={handleSubmit}
      >
        <Label htmlFor="reader-input" className="sr-only">
          Paste English text
        </Label>
        <textarea
          id="reader-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={MAX_CONTENT_LENGTH}
          placeholder="Paste an AI reply, an article or any passage here."
          className="field-sizing-content max-h-[60vh] min-h-56 w-full resize-none overflow-y-auto border-0 bg-transparent px-4 py-3 text-base outline-none"
        />
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-3">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5" aria-hidden="true" />
            Only you can see it. Deleted automatically after 7 days.
          </p>
          <div className="flex items-center gap-3">
            {draft.length === 0 && (
              <Button asChild variant="ghost" size="sm">
                <Link href="/reader/sample">Try a sample</Link>
              </Button>
            )}
            {nearLimit && (
              <span
                className={cn(
                  'text-xs',
                  draft.length > MAX_CONTENT_LENGTH
                    ? 'text-destructive'
                    : 'text-muted-foreground'
                )}
              >
                {draft.length.toLocaleString()} /{' '}
                {MAX_CONTENT_LENGTH.toLocaleString()} characters
              </span>
            )}
            <Button type="submit" variant="brand" disabled={!canRead}>
              Start reading
            </Button>
          </div>
        </div>
      </form>

      {recentDocuments.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">Recent</h3>
            <Link
              href="/reader/history"
              className="rounded-sm text-sm text-brand underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring active:opacity-70"
            >
              View all
            </Link>
          </div>
          <ul className="divide-y divide-border rounded-lg border">
            {recentDocuments.map((doc) => (
              <li key={doc.id}>
                <button
                  type="button"
                  onClick={() => handleOpenRecent(doc.id)}
                  disabled={openingId !== null}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:bg-muted disabled:opacity-50"
                >
                  <FileText
                    className="size-4 shrink-0 text-brand"
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {openingId === doc.id
                      ? 'Opening…'
                      : doc.preview || 'Untitled'}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {new Date(doc.updatedAt).toLocaleDateString()}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {openError && (
            <p className="text-sm text-destructive">{openError}</p>
          )}
        </section>
      )}
    </div>
  )
}
