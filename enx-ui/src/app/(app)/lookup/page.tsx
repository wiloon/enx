'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { useQueryClient } from '@tanstack/react-query'
import { apiService } from '@/services/api'
import { useIsAdmin } from '@/hooks/useIsAdmin'
import { recordLookup } from '@/lib/queryCount'
import {
  lookupAnswer,
  offersPlans,
  shownLookupSource,
  type LookupAnswer,
} from '@/lib/lookupAnswer'
import WordSearchForm from './WordSearchForm'
import WordResultCard from './WordResultCard'
import WordResultCardSkeleton from './WordResultCardSkeleton'
import PageHeader from '@/components/app/PageHeader'

function PlansLink() {
  return (
    <div className="mt-2">
      <Link
        href="/billing"
        className="rounded-sm font-medium text-brand underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring active:opacity-70"
      >
        See plans
      </Link>
    </div>
  )
}

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
    code?: string
    upgrade?: true
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
          code: response.code,
          upgrade: response.upgrade,
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
      const { message, code, upgrade, ...state } = recorded
      setLookup({
        isPending: false,
        data: {
          ...answer,
          word: { ...answer.word, ...state },
          message,
          code,
          upgrade,
        },
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

      {lookup.isPending && <WordResultCardSkeleton />}

      {lookup.error && (
        <div className="py-8 text-center text-sm text-destructive">
          {lookup.error}
          {offersPlans(lookup) && <PlansLink />}
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
        <div className="text-sm text-destructive">
          {lookup.data.message}
          {offersPlans(lookup.data) && <PlansLink />}
        </div>
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
