'use client'

import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { apiService } from '@/services/api'
import { useIsAdmin } from '@/hooks/useIsAdmin'
import { recordLookup } from '@/lib/queryCount'
import {
  lookupAnswer,
  shownLookupSource,
  type LookupAnswer,
} from '@/lib/lookupAnswer'
import WordSearchForm from './WordSearchForm'
import WordResultCard from './WordResultCard'
import PageHeader from '@/components/app/PageHeader'

export default function WordLookupPage() {
  const [searchWord, setSearchWord] = useState('')
  const [clearing, setClearing] = useState(false)
  const queryClient = useQueryClient()
  const { isAdmin } = useIsAdmin()

  const generation = useRef(0)
  const pendingRequest = useRef(false)
  const [lookup, setLookup] = useState<{
    isPending: boolean
    data?: LookupAnswer
    error?: string
  }>({ isPending: false })
  const [currentWord, setCurrentWord] = useState('')

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (pendingRequest.current) return
    const word = searchWord.trim().toLowerCase()
    if (!word) return
    const request = ++generation.current
    pendingRequest.current = true
    setCurrentWord(word)
    setLookup({ isPending: true })
    try {
      const response = await apiService.dictionaryEntries(word)
      if (request !== generation.current) return
      if (!response.success) {
        setLookup({
          isPending: false,
          error: response.error || 'Failed to look up the word',
        })
        return
      }
      const answer = lookupAnswer(word, response.data)
      setLookup({ isPending: false, data: answer })
      pendingRequest.current = false
      if (answer.kind !== 'result' || !answer.word.Id) return
      const recorded = await recordLookup(answer.word.Id, (id) =>
        apiService.recordWordLookup(id)
      )
      void queryClient.invalidateQueries({ queryKey: ['word-list'] })
      void queryClient.invalidateQueries({ queryKey: ['stats-overview'] })
      if (request !== generation.current) return
      const { message, ...state } = recorded
      setLookup({
        isPending: false,
        data: { ...answer, word: { ...answer.word, ...state }, message },
      })
    } catch {
      if (request === generation.current)
        setLookup({ isPending: false, error: 'Failed to look up the word' })
    } finally {
      if (request === generation.current) pendingRequest.current = false
    }
  }

  const handleClear = async () => {
    if (!currentWord) return
    ++generation.current
    pendingRequest.current = false
    setClearing(true)
    try {
      await apiService.deleteWord(currentWord)
      setLookup({ isPending: false })
      setCurrentWord('')
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

      {lookup.error && (
        <div className="py-8 text-center text-sm text-destructive">
          {lookup.error}
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

      {lookup.data?.kind === 'result' && lookup.data.message && (
        <div className="text-sm text-destructive">{lookup.data.message}</div>
      )}

      {lookup.data?.kind === 'no-answer' && (
        <div className="py-8 text-center text-sm text-destructive">
          The dictionary didn&apos;t answer. Please look it up again.
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
