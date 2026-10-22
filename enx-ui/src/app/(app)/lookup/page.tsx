'use client'

import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiService } from '@/services/api'
import { useIsAdmin } from '@/hooks/useIsAdmin'
import { countLookup } from '@/lib/queryCount'
import {
  LookupFailure,
  canRetryLookup,
  classifyLookupAnswer,
  shownLookupSource,
} from '@/lib/lookupAnswer'
import { Button } from '@/components/ui/button'
import WordSearchForm from './WordSearchForm'
import WordResultCard from './WordResultCard'
import PageHeader from '@/components/app/PageHeader'

export default function WordLookupPage() {
  const [searchWord, setSearchWord] = useState('')
  const [clearing, setClearing] = useState(false)
  // Set from the moment a lookup starts until it settles, so a second click
  // before the page re-renders sends nothing.
  const inFlight = useRef(false)
  const queryClient = useQueryClient()
  const { isAdmin } = useIsAdmin()

  // Fire and forget. Once it settles, either way, the pages that show the
  // query count and the vocabulary count read the server again.
  const recordLookup = (wordId: string) => {
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: ['word-list'] })
      void queryClient.invalidateQueries({ queryKey: ['stats-overview'] })
    }
    void apiService.recordWordLookup(wordId).then(refresh, refresh)
  }

  // A mutation, not a query: every submit is a lookup that counts, so
  // nothing is cached and nothing refetches on its own.
  const lookup = useMutation({
    mutationFn: async (word: string) => {
      const response = await apiService.lookupWord(word)
      if (!response.success || !response.data) {
        throw new LookupFailure(
          response.error || 'Failed to look up the word',
          { status: response.status, networkFailure: response.networkFailure }
        )
      }
      // Only a definition is shown and counted.
      const kind = classifyLookupAnswer(response.data)
      if (kind !== 'result') return { kind } as const
      return { kind, word: countLookup(response.data, recordLookup) } as const
    },
    onSettled: () => {
      inFlight.current = false
    },
  })
  const currentWord = lookup.variables ?? ''

  const startLookup = (word: string) => {
    if (inFlight.current || lookup.isPending) return
    inFlight.current = true
    lookup.mutate(word)
  }

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    const word = searchWord.trim().toLowerCase()
    if (word) startLookup(word)
  }

  // The word the failed lookup was sent for, not what the input says now.
  const handleRetry = () => {
    if (lookup.variables) startLookup(lookup.variables)
  }

  const handleClear = async () => {
    if (!currentWord) return
    setClearing(true)
    try {
      await apiService.deleteWord(currentWord)
      lookup.reset()
      setSearchWord('')
    } finally {
      setClearing(false)
    }
  }

  const retryButton = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleRetry}
      disabled={lookup.isPending}
    >
      Retry
    </Button>
  )

  return (
    <div className="container mx-auto max-w-2xl space-y-6 p-6 md:p-8">
      <PageHeader
        title="Word Lookup"
        description="Look up an English word without opening a page."
      />
      <WordSearchForm
        value={searchWord}
        onChange={setSearchWord}
        onSearch={handleSearch}
        pending={lookup.isPending}
      />

      {lookup.isPending && (
        <div
          data-testid="word-result-skeleton"
          className="animate-pulse space-y-4 rounded-xl border p-6"
          aria-hidden="true"
        >
          <div className="h-8 w-40 rounded bg-muted" />
          <div className="h-4 w-24 rounded bg-muted" />
          <div className="h-6 w-full rounded bg-muted" />
          <div className="h-4 w-1/2 rounded bg-muted" />
        </div>
      )}

      {lookup.isError && (
        <div className="flex flex-col items-center gap-3 py-8">
          <p className="text-center text-sm text-destructive">
            {lookup.error.message}
          </p>
          {canRetryLookup(lookup.error) && retryButton}
        </div>
      )}

      {lookup.data?.kind === 'result' && (
        <WordResultCard
          data={lookup.data.word}
          onClear={isAdmin ? handleClear : undefined}
          clearing={clearing}
          source={isAdmin ? shownLookupSource(lookup.data.word.Source) : null}
        />
      )}

      {lookup.data?.kind === 'no-answer' && (
        <div className="flex flex-col items-center gap-3 py-8">
          <p className="text-center text-sm text-destructive">
            The dictionary didn&apos;t answer. Please try again.
          </p>
          {retryButton}
        </div>
      )}

      {lookup.data?.kind === 'miss' && (
        <div className="py-8 text-center text-sm text-muted-foreground">
          No data found for &quot;{currentWord}&quot;
        </div>
      )}
    </div>
  )
}
