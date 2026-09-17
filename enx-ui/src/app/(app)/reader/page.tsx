'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Pencil } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { requestReaderMode, webStoreUrl } from '@/lib/enxExtension'
import { useExtensionStatus } from '@/hooks/useExtensionStatus'
import { apiService } from '@/services/api'
import { consumeReaderDocument } from '@/lib/readerSession'
import { MAX_CONTENT_LENGTH } from './constants'

// Split pasted plain text into paragraphs on blank lines; keep newlines
// inside a paragraph (rendered with `white-space: pre-wrap`).
function toParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
}

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
  const extensionStatus = useExtensionStatus()

  const paragraphs = useMemo(
    () => (article ? toParagraphs(article) : []),
    [article]
  )

  const canRead =
    draft.trim().length > 0 && draft.length <= MAX_CONTENT_LENGTH

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
      if (resp.success && resp.data) setDocumentId(resp.data.id)
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

  // Reopening a document from "My Documents" (history page): it's already
  // persisted, so this just renders it -- no POST. Its id is remembered so a
  // later "Edit text" + Read updates this document instead of creating one.
  useEffect(() => {
    const parsed = consumeReaderDocument()
    if (parsed?.content) {
      setDraft(parsed.content)
      setDocumentId(parsed.id ?? null)
      setSaveStatus('saved')
      setArticle(parsed.content)
      setReadSeq((n) => n + 1)
    }
    // Only ever relevant right after navigating in from a document list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      <div className="container mx-auto max-w-2xl p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/40 px-4 py-2.5">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-muted-foreground">
              Reading mode
            </span>
            <span className="text-xs text-muted-foreground" role="status">
              {saveStatus === 'saving' && 'Saving…'}
              {saveStatus === 'saved' && 'Saved · kept for 7 days'}
              {saveStatus === 'error' && "Couldn't save (still readable)"}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/reader/history"
              className="text-sm font-medium text-muted-foreground underline-offset-4 hover:underline"
            >
              My Documents
            </Link>
            <Button type="button" variant="outline" size="sm" onClick={handleNew}>
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
          <div className="flex items-start justify-between gap-4 rounded-md border border-input bg-muted/40 p-3 text-sm">
            <p>
              {storeUrl ? (
                <a
                  href={storeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium underline"
                >
                  Install the Catglish extension
                </a>
              ) : (
                <span className="font-medium">Install the Catglish extension</span>
              )}{' '}
              to click any word on this page for its definition.
            </p>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => setPromptDismissed(true)}
              className="text-muted-foreground hover:text-foreground"
            >
              ×
            </button>
          </div>
        )}
        <article
          id="enx-reader-article"
          className="prose max-w-none whitespace-pre-wrap text-base leading-7"
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

  return (
    <div className="container mx-auto p-6 max-w-2xl">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Reader</CardTitle>
          <Link
            href="/reader/history"
            className="text-sm font-medium text-muted-foreground underline-offset-4 hover:underline"
          >
            My Documents
          </Link>
        </CardHeader>
        <CardContent className="space-y-4">
          <form className="space-y-2" onSubmit={handleSubmit}>
            <Label htmlFor="reader-input">Paste English text</Label>
            <textarea
              id="reader-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={10}
              maxLength={MAX_CONTENT_LENGTH}
              placeholder="Paste an article or a passage to read and look up words."
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {draft.length.toLocaleString()} /{' '}
                {MAX_CONTENT_LENGTH.toLocaleString()} · saved for 7 days
              </span>
              <Button type="submit" disabled={!canRead}>
                Read
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
