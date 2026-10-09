'use client'

import { useEffect, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { apiService } from '@/services/api'
import type { WordListStatus } from '@/types'

const PAGE_SIZE = 50

const FILTERS: { value: WordListStatus; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'learning', label: 'Learning' },
  { value: 'known', label: 'Known' },
]

// Waits for the user to stop typing before querying, so a search is one
// request rather than one per keystroke.
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return debounced
}

// The user's word list: every word looked up in an article (user_dicts),
// including the ones marked known, most recently touched first.
export default function WordListPage() {
  const [status, setStatus] = useState<WordListStatus>('all')
  const [search, setSearch] = useState('')
  const q = useDebounced(search.trim(), 300)

  const {
    data,
    isLoading,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['word-list', status, q],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const resp = await apiService.listMyWords({
        status,
        q: q || undefined,
        limit: PAGE_SIZE,
        offset: pageParam,
      })
      if (resp.success && resp.data) return resp.data
      throw new Error(resp.error || 'Failed to load your word list')
    },
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.words.length, 0)
      return loaded < last.total ? loaded : undefined
    },
  })

  const words = data?.pages.flatMap((p) => p.words) ?? []
  const total = data?.pages[0]?.total

  return (
    <div className="container mx-auto p-6 max-w-3xl">
      <Card>
        <CardHeader>
          <CardTitle>Word List</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Every word you have looked up while reading, most recent first.
            Words you mark as known stop being underlined.
          </p>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div
              className="inline-flex rounded-md border border-border p-0.5"
              role="group"
              aria-label="Filter words"
            >
              {FILTERS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  aria-pressed={status === f.value}
                  onClick={() => setStatus(f.value)}
                  className={`rounded px-3 py-1 text-sm transition-colors ${
                    status === f.value
                      ? 'bg-muted font-medium text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <Input
              type="search"
              placeholder="Search words"
              aria-label="Search words"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="sm:max-w-56"
            />
          </div>

          {total !== undefined && (
            <p className="text-xs text-muted-foreground">
              {total.toLocaleString()} {total === 1 ? 'word' : 'words'}
            </p>
          )}

          {isLoading && (
            <div className="text-center py-8 text-muted-foreground">
              Loading…
            </div>
          )}

          {error && (
            <div className="text-center py-8 text-red-600">
              {error instanceof Error
                ? error.message
                : 'Failed to load your word list'}
            </div>
          )}

          {data && words.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              {q
                ? `No words start with "${q}".`
                : status === 'known'
                  ? 'No words marked as known yet.'
                  : 'No words yet. Turn on Catglish on an English page and click a word to look it up.'}
            </div>
          )}

          {words.length > 0 && (
            <ul className="divide-y divide-border">
              {words.map((w) => (
                <li key={w.english} className="flex gap-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-medium">{w.english}</span>
                      {w.pronunciation && (
                        <span className="text-xs text-muted-foreground">
                          /{w.pronunciation}/
                        </span>
                      )}
                      {w.known && <Badge variant="secondary">Known</Badge>}
                    </div>
                    {w.chinese && (
                      <p className="mt-0.5 line-clamp-2 whitespace-pre-line text-sm text-muted-foreground">
                        {w.chinese}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 text-right text-xs text-muted-foreground">
                    <div>
                      Looked up {w.queryCount}{' '}
                      {w.queryCount === 1 ? 'time' : 'times'}
                    </div>
                    <div>{new Date(w.updatedAt).toLocaleDateString()}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {hasNextPage && (
            <div className="text-center">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isFetchingNextPage}
                onClick={() => fetchNextPage()}
              >
                {isFetchingNextPage ? 'Loading…' : 'Load more'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
