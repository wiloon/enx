'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  useInfiniteQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query'
import { Check, MoreHorizontal, Repeat, Trash2, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { apiService } from '@/services/api'
import { lastLookedUpLabel, lookupTimesTitle } from '@/lib/lookupTime'
import { REVIEW_BUCKET_COLORS, reviewBucket } from '@/lib/reviewBucket'
import { withKnown, withoutWord } from '@/lib/wordListPages'
import type {
  WordListEntry,
  WordListPage as WordListData,
  WordListSort,
  WordListStatus,
} from '@/types'
import PageHeader from '@/components/app/PageHeader'

const PAGE_SIZE = 50
// How long a removed word can still be brought back with Undo before the
// removal is sent to the server.
const UNDO_MS = 5000

const FILTERS: { value: WordListStatus; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'learning', label: 'Learning' },
  { value: 'known', label: 'Known' },
]

const SORTS: { value: WordListSort; label: string }[] = [
  { value: 'recent', label: 'Recent' },
  { value: 'lookups', label: 'Most looked up' },
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

function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div
      className="inline-flex rounded-md border border-border p-0.5"
      role="group"
      aria-label={label}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded px-3 py-1 text-sm transition-colors ${
            value === o.value
              ? 'bg-muted font-medium text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// The user's word list: every word looked up in an article (user_dicts),
// including the ones marked known.
export default function WordListPage() {
  const [status, setStatus] = useState<WordListStatus>('all')
  const [sort, setSort] = useState<WordListSort>('recent')
  const [search, setSearch] = useState('')
  const q = useDebounced(search.trim(), 300)
  // The word the user just removed: hidden from the list while the Undo
  // offer is open.
  const [pending, setPending] = useState<string | null>(null)
  const [marking, setMarking] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const queryClient = useQueryClient()

  // Sends the removal. If the server refuses, the word shows up again.
  const commit = useCallback(
    async (english: string) => {
      const settle = () =>
        setPending((current) => (current === english ? null : current))
      const resp = await apiService.removeMyWord(english)
      if (!resp.success) {
        setActionError(resp.error || 'Failed to remove the word')
        settle()
        return
      }
      // Drop the word from every cached filter and search, so no other view
      // of the list still shows it.
      queryClient.setQueriesData<InfiniteData<WordListData>>(
        { queryKey: ['word-list'] },
        (cached) => cached && withoutWord(cached, english)
      )
      settle()
    },
    [queryClient]
  )

  useEffect(() => {
    if (!pending) return
    const timer = setTimeout(() => commit(pending), UNDO_MS)
    return () => clearTimeout(timer)
  }, [pending, commit])

  // Leaving the page ends the undo offer, not the removal.
  const pendingRef = useRef(pending)
  useEffect(() => {
    pendingRef.current = pending
  }, [pending])
  useEffect(
    () => () => {
      if (pendingRef.current) commit(pendingRef.current)
    },
    [commit]
  )

  const remove = (english: string) => {
    setActionError(null)
    if (pending && pending !== english) commit(pending)
    setPending(english)
  }

  // /api/mark is a toggle: the answer, not the menu item chosen, says
  // whether the word is known now.
  const toggleKnown = async (english: string) => {
    setActionError(null)
    setMarking(english)
    const resp = await apiService.markWord(english)
    setMarking(null)
    if (!resp.success || !resp.data) {
      setActionError(resp.error || 'Failed to mark the word')
      return
    }
    const known = resp.data.AlreadyAcquainted === 1
    for (const [key, cached] of queryClient.getQueriesData<
      InfiniteData<WordListData>
    >({ queryKey: ['word-list'] })) {
      if (!cached) continue
      const viewStatus = key[1] as WordListStatus
      queryClient.setQueryData(
        key,
        withKnown(cached, viewStatus, english, known)
      )
    }
    // A view the word newly belongs in picks it up when it is next shown.
    queryClient.invalidateQueries({
      queryKey: ['word-list'],
      refetchType: 'none',
    })
  }

  const {
    data,
    isLoading,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['word-list', status, sort, q],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const resp = await apiService.listMyWords({
        status,
        sort,
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

  const words = (data?.pages.flatMap((p) => p.words) ?? []).filter(
    (w) => w.english !== pending
  )
  const loadedTotal = data?.pages[0]?.total
  const total =
    loadedTotal === undefined ? undefined : loadedTotal - (pending ? 1 : 0)
  const now = new Date()

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6 md:p-8">
      <PageHeader
        title="Word List"
        description="Every word you have looked up while reading, including the ones you already know. The dot matches the word's underline on the page: the fewer lookups, the darker it is."
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <Segmented
          label="Filter words"
          options={FILTERS}
          value={status}
          onChange={setStatus}
        />
        <Segmented
          label="Sort words"
          options={SORTS}
          value={sort}
          onChange={setSort}
        />
        <Input
          type="search"
          placeholder="Search words"
          aria-label="Search words"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="sm:ml-auto sm:max-w-56"
        />
      </div>

      {actionError && (
        <p role="alert" className="text-sm text-red-600">
          {actionError}
        </p>
      )}

      {total !== undefined && (
        <p className="text-xs text-muted-foreground">
          {total.toLocaleString()} {total === 1 ? 'word' : 'words'}
        </p>
      )}

      {isLoading && (
        <div className="py-8 text-center text-muted-foreground">Loading…</div>
      )}

      {error && (
        <div className="py-8 text-center text-red-600">
          {error instanceof Error
            ? error.message
            : 'Failed to load your word list'}
        </div>
      )}

      {data && words.length === 0 && (
        <div className="py-8 text-center text-muted-foreground">
          {q
            ? `No words start with "${q}".`
            : status === 'known'
              ? 'No words marked as known yet.'
              : 'No words yet. Turn on Catglish on an English page and click a word to look it up.'}
        </div>
      )}

      {words.length > 0 && (
        <ul className="divide-y divide-border border-y border-border">
          {words.map((w) => (
            <WordRow
              key={w.english}
              word={w}
              now={now}
              expanded={expanded === w.english}
              onToggleExpanded={() =>
                setExpanded((e) => (e === w.english ? null : w.english))
              }
              marking={marking === w.english}
              onToggleKnown={() => toggleKnown(w.english)}
              onRemove={() => remove(w.english)}
            />
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

      {pending && (
        <div
          role="status"
          className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-sm items-center justify-between gap-3 rounded-md border border-border bg-background px-4 py-2 text-sm shadow-lg"
        >
          <span className="min-w-0 truncate">
            Removed <span className="font-medium">{pending}</span>
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPending(null)}
          >
            Undo
          </Button>
        </div>
      )}
    </div>
  )
}

function WordRow({
  word: w,
  now,
  expanded,
  onToggleExpanded,
  marking,
  onToggleKnown,
  onRemove,
}: {
  word: WordListEntry
  now: Date
  expanded: boolean
  onToggleExpanded: () => void
  marking: boolean
  onToggleKnown: () => void
  onRemove: () => void
}) {
  const bucket = reviewBucket(w)
  const lookupCountLabel = `Looked up ${w.queryCount} ${w.queryCount === 1 ? 'time' : 'times'}`
  return (
    <li className="group flex items-start gap-3 py-3">
      <span
        aria-hidden="true"
        className="mt-2 size-2 shrink-0 rounded-full"
        style={{
          backgroundColor:
            bucket === null ? 'transparent' : REVIEW_BUCKET_COLORS[bucket - 1],
        }}
      />
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggleExpanded}
        className="min-w-0 flex-1 rounded-sm text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium">{w.english}</span>
          {w.pronunciation && (
            <span className="text-xs text-muted-foreground">
              /{w.pronunciation}/
            </span>
          )}
          {w.known && <Badge variant="secondary">Known</Badge>}
        </span>
        {w.chinese && (
          <span
            // line-clamp brings its own display (-webkit-box); `block` would
            // override it and show every line.
            className={`mt-0.5 whitespace-pre-line text-sm text-muted-foreground ${
              expanded ? 'block' : 'line-clamp-2'
            }`}
          >
            {w.chinese}
          </span>
        )}
      </button>
      <div className="flex shrink-0 items-center gap-3 pt-0.5 text-xs text-muted-foreground">
        {/* The same icon, number and wording as the extension's word popover
            and Side Panel card. */}
        <span
          className="inline-flex items-center gap-1 tabular-nums"
          title={lookupCountLabel}
        >
          <Repeat className="size-3" aria-hidden="true" />
          <span aria-hidden="true">{w.queryCount}</span>
          <span className="sr-only">{lookupCountLabel}</span>
        </span>
        <span title={lookupTimesTitle(w.firstLookedUpAt, w.lastLookedUpAt)}>
          {lastLookedUpLabel(w.lastLookedUpAt, now)}
        </span>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`More actions for ${w.english}`}
            className="-my-1 size-7 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100"
          >
            <MoreHorizontal aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={marking} onSelect={onToggleKnown}>
            {w.known ? (
              <Undo2 aria-hidden="true" />
            ) : (
              <Check aria-hidden="true" />
            )}
            {w.known ? 'Mark as learning' : 'Mark as known'}
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={onRemove}>
            <Trash2 aria-hidden="true" />
            Remove
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}
