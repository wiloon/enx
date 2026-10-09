'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { apiService } from '@/services/api'
import type { SavedPage } from '@/types'

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
    <div className="container mx-auto p-6 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>Saved Pages</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Pages you saved with &ldquo;Save this page&rdquo; in the Catglish
            extension. Only the address and title are kept.
          </p>

          {isLoading && (
            <div className="text-center py-8 text-muted-foreground">
              Loading…
            </div>
          )}

          {error && (
            <div className="text-center py-8 text-red-600">
              {error instanceof Error
                ? error.message
                : 'Failed to load saved pages'}
            </div>
          )}

          {actionError && (
            <div className="text-sm text-red-600">{actionError}</div>
          )}

          {data && data.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              No saved pages yet. Open the Catglish extension on a page and
              choose &ldquo;Save this page&rdquo;.
            </div>
          )}

          {data && data.length > 0 && (
            <ul className="divide-y divide-border">
              {data.map((page) => (
                <li
                  key={page.id}
                  className="flex items-center justify-between gap-4 py-3"
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
          )}
        </CardContent>
      </Card>
    </div>
  )
}
