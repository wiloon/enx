'use client'

import { useEffect, useMemo, useState } from 'react'
import { Pencil } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { requestReaderMode, webStoreUrl } from '@/lib/enxExtension'
import { useExtensionStatus } from '@/hooks/useExtensionStatus'

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
  // Bumped on every submit so re-reading the same text still re-triggers the
  // extension (state value alone wouldn't change).
  const [readSeq, setReadSeq] = useState(0)
  const [promptDismissed, setPromptDismissed] = useState(false)
  const extensionStatus = useExtensionStatus()

  const paragraphs = useMemo(
    () => (article ? toParagraphs(article) : []),
    [article]
  )

  const canRead = draft.trim().length > 0

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canRead) return
    setArticle(draft)
    setReadSeq((n) => n + 1)
  }

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
        <div className="flex items-center justify-between rounded-md border bg-muted/40 px-4 py-2.5">
          <span className="text-sm font-medium text-muted-foreground">
            Reading mode
          </span>
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
                  Install the ENX extension
                </a>
              ) : (
                <span className="font-medium">Install the ENX extension</span>
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
        <CardHeader>
          <CardTitle>Reader</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <form className="space-y-2" onSubmit={handleSubmit}>
            <Label htmlFor="reader-input">Paste English text</Label>
            <textarea
              id="reader-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={10}
              placeholder="Paste an article or a passage to read and look up words."
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="flex justify-end">
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
