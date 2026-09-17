'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronRight } from 'lucide-react'
import { apiService } from '@/services/api'
import { stashReaderDocument } from '@/lib/readerSession'
import type { ReaderDocumentSummary } from '@/types'

// Rough "2h ago" for a document's updatedAt. Precise enough for a list whose
// entries expire after 7 days anyway (ADR-022).
function timeAgo(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const minutes = Math.floor((Date.now() - then) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

const MAX_ITEMS = 3

export default function ContinueReading({
  documents,
  isLoading,
  isError,
}: {
  documents?: ReaderDocumentSummary[]
  isLoading: boolean
  isError: boolean
}) {
  const router = useRouter()
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)

  // Same hand-off as My Documents: fetch the content, stash it, let /reader
  // render it without a second POST.
  const handleOpen = async (id: string) => {
    setOpenError(null)
    setOpeningId(id)
    const resp = await apiService.getReaderDocument(id)
    setOpeningId(null)
    if (!resp.success || !resp.data) {
      setOpenError(resp.error || 'Failed to open document')
      return
    }
    stashReaderDocument({ id: resp.data.id, content: resp.data.content })
    router.push('/reader')
  }

  return (
    <section className="rounded-lg border bg-card p-4 text-card-foreground">
      <h3 className="text-sm font-semibold">Continue reading</h3>

      {isLoading && (
        <div className="mt-3 space-y-2" aria-hidden>
          <div className="h-10 animate-pulse rounded bg-muted" />
          <div className="h-10 animate-pulse rounded bg-muted" />
        </div>
      )}

      {/* Home is the first screen after sign-in, so every block degrades on
          its own rather than taking the page down (ADR-027 Mitigation). */}
      {isError && (
        <p className="mt-3 text-sm text-muted-foreground">
          Couldn&apos;t load your documents.
        </p>
      )}

      {openError && <p className="mt-3 text-sm text-red-600">{openError}</p>}

      {!isLoading && !isError && (
        <ul className="mt-2 divide-y divide-border">
          {documents?.slice(0, MAX_ITEMS).map((doc) => (
            <li key={doc.id}>
              <button
                type="button"
                onClick={() => handleOpen(doc.id)}
                disabled={openingId === doc.id}
                className="group flex w-full items-center gap-3 py-2.5 text-left disabled:opacity-50"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm group-hover:text-brand">
                    {openingId === doc.id ? 'Opening…' : doc.preview || 'Untitled'}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {timeAgo(doc.updatedAt)}
                  </span>
                </span>
                <ChevronRight
                  aria-hidden
                  className="size-4 shrink-0 text-muted-foreground"
                />
              </button>
            </li>
          ))}
        </ul>
      )}

      <Link
        href="/reader/history"
        className="mt-2 inline-block text-xs font-medium text-muted-foreground underline-offset-4 hover:text-brand hover:underline"
      >
        View all
      </Link>
    </section>
  )
}
