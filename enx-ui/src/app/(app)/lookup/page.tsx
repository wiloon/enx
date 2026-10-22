'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiService } from '@/services/api'
import { useIsAdmin } from '@/hooks/useIsAdmin'
import { countLookup } from '@/lib/queryCount'
import WordSearchForm from './WordSearchForm'
import WordResultCard from './WordResultCard'
import PageHeader from '@/components/app/PageHeader'

export default function WordLookupPage() {
  const [searchWord, setSearchWord] = useState('')
  const [clearing, setClearing] = useState(false)
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
        throw new Error(response.error || 'Failed to look up the word')
      }
      // No definition is a miss: nothing to show and nothing to count.
      if (!response.data.Chinese) return null
      return countLookup(response.data, recordLookup)
    },
  })
  const currentWord = lookup.variables ?? ''

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (lookup.isPending) return
    const word = searchWord.trim().toLowerCase()
    if (word) lookup.mutate(word)
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
        <div className="py-8 text-center text-sm text-destructive">
          {lookup.error.message}
        </div>
      )}

      {lookup.isSuccess && lookup.data && (
        <WordResultCard
          data={lookup.data}
          onClear={isAdmin ? handleClear : undefined}
          clearing={clearing}
        />
      )}

      {lookup.isSuccess && !lookup.data && (
        <div className="py-8 text-center text-sm text-muted-foreground">
          No data found for &quot;{currentWord}&quot;
        </div>
      )}
    </div>
  )
}
