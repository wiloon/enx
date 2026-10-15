'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bookmark, Trash2 } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { apiService } from '@/services/api'
import type { SavedPage } from '@/types'
import PageHeader from '@/components/app/PageHeader'

// Pages saved from the extension popup's "Save this page" (ADR-032): URL and
// title only, newest first.
export default function SavedPagesPage() {
  const queryClient = useQueryClient()
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ['saved-pages'],
    queryFn: async () => {
      const resp = await apiService.listSavedPages()
      if (resp.success && resp.data) return resp.data.pages
      throw new Error(resp.error || 'Failed to load saved pages')
    },
  })

  const handleDelete = async (id: string) => {
    setActionError(null)
    setDeletingId(id)
    const resp = await apiService.deleteSavedPage(id)
    setDeletingId(null)
    if (!resp.success) {
      setActionError(resp.error || 'Failed to delete the page')
      return
    }
    queryClient.setQueryData<SavedPage[]>(['saved-pages'], (pages) =>
      pages?.filter((p) => p.id !== id)
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-6 md:p-8">
      <PageHeader
        title="Saved Pages"
        description="Articles you saved to come back to. Only the address and title are kept."
      />

      {isLoading && (
        <div className="py-8 text-center text-sm text-muted-foreground">
          Loading…
        </div>
      )}

      {error && (
        <div className="py-8 text-center text-sm text-red-600">
          {error instanceof Error
            ? error.message
            : 'Failed to load saved pages'}
        </div>
      )}

      {actionError && <div className="text-sm text-red-600">{actionError}</div>}

      {data && data.length === 0 && (
        <div className="flex flex-col items-center rounded-lg border border-dashed px-6 py-12 text-center">
          <div className="flex size-10 items-center justify-center rounded-full bg-muted">
            <Bookmark
              className="size-5 text-muted-foreground"
              aria-hidden="true"
            />
          </div>
          <p className="mt-4 font-medium">No saved pages yet</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            On a page you want to keep, open the Catglish extension and choose
            &ldquo;Save this page&rdquo;.
          </p>
        </div>
      )}

      {data && data.length > 0 && (
        <Card className="py-0">
          <ul className="divide-y divide-border">
            {data.map((page) => (
              <li
                key={page.id}
                className="flex items-center justify-between gap-4 px-6 py-3"
              >
                <a
                  href={page.url}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 flex-1 hover:underline"
                >
                  <span className="block truncate text-sm">
                    {page.title || page.url}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {page.host} ·{' '}
                    {new Date(page.createdAt).toLocaleDateString()}
                  </span>
                </a>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Delete ${page.title || page.url}`}
                  disabled={deletingId === page.id}
                  onClick={() => handleDelete(page.id)}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
