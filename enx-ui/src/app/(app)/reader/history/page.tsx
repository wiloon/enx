'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Trash2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { apiService } from '@/services/api'
import { stashReaderDocument } from '@/lib/readerSession'
import PageHeader from '@/components/app/PageHeader'

export default function ReaderHistoryPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ['reader-documents'],
    queryFn: async () => {
      const resp = await apiService.listReaderDocuments()
      if (resp.success && resp.data) return resp.data.documents
      throw new Error(resp.error || 'Failed to load documents')
    },
  })

  const handleOpen = async (id: string) => {
    setActionError(null)
    setOpeningId(id)
    const resp = await apiService.getReaderDocument(id)
    setOpeningId(null)
    if (!resp.success || !resp.data) {
      setActionError(resp.error || 'Failed to open document')
      return
    }
    stashReaderDocument({ id: resp.data.id, content: resp.data.content })
    router.push('/reader')
  }

  const handleDelete = async (id: string) => {
    setActionError(null)
    setDeletingId(id)
    const resp = await apiService.deleteReaderDocument(id)
    setDeletingId(null)
    if (!resp.success) {
      setActionError(resp.error || 'Failed to delete document')
      return
    }
    queryClient.setQueryData<typeof data>(['reader-documents'], (docs) =>
      docs?.filter((d) => d.id !== id)
    )
  }

  return (
    <div className="container mx-auto max-w-2xl space-y-4 p-6 md:p-8">
      <Link
        href="/reader"
        aria-label="Back to Reader"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Reader
      </Link>
      <PageHeader
        title="My Documents"
        description="Pasted articles are kept for 7 days, up to 50 at a time."
      />
      <Card>
        <CardContent className="space-y-4">
          {isLoading && (
            <div className="text-center py-8 text-muted-foreground">
              Loading…
            </div>
          )}

          {error && (
            <div className="text-center py-8 text-red-600">
              {error instanceof Error
                ? error.message
                : 'Failed to load documents'}
            </div>
          )}

          {actionError && (
            <div className="text-sm text-red-600">{actionError}</div>
          )}

          {data && data.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              No saved documents yet.
            </div>
          )}

          {data && data.length > 0 && (
            <ul className="divide-y divide-border">
              {data.map((doc) => (
                <li
                  key={doc.id}
                  className="flex items-center justify-between gap-4 py-3"
                >
                  <button
                    type="button"
                    onClick={() => handleOpen(doc.id)}
                    disabled={openingId === doc.id}
                    className="min-w-0 flex-1 text-left hover:underline disabled:opacity-50"
                  >
                    <span className="block truncate text-sm">
                      {openingId === doc.id
                        ? 'Opening…'
                        : doc.preview || 'Untitled'}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {new Date(doc.updatedAt).toLocaleString()}
                    </span>
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label="Delete document"
                    disabled={deletingId === doc.id}
                    onClick={() => handleDelete(doc.id)}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
