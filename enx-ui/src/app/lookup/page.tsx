'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { apiService } from '@/services/api'
import WordSearchForm from './WordSearchForm'
import WordResultCard from './WordResultCard'

export default function WordLookupPage() {
  const [searchWord, setSearchWord] = useState('')
  const [currentWord, setCurrentWord] = useState('')
  const [clearing, setClearing] = useState(false)
  const queryClient = useQueryClient()

  const { data: wordData, isLoading, error } = useQuery({
    queryKey: ['word-lookup', currentWord],
    queryFn: async () => {
      if (!currentWord) return null
      const response = await apiService.lookupWord(currentWord)
      if (response.success) {
        return response.data
      }
      throw new Error(response.error || 'Failed to lookup word')
    },
    enabled: !!currentWord,
  })

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (searchWord.trim()) {
      setCurrentWord(searchWord.trim().toLowerCase())
    }
  }

  const handleClear = async () => {
    if (!currentWord) return
    setClearing(true)
    try {
      await apiService.deleteWord(currentWord)
      queryClient.removeQueries({ queryKey: ['word-lookup', currentWord] })
      setCurrentWord('')
      setSearchWord('')
    } finally {
      setClearing(false)
    }
  }

  return (
    <div className="container mx-auto p-6 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>Word Lookup</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <WordSearchForm
            value={searchWord}
            onChange={setSearchWord}
            onSearch={handleSearch}
          />

          {isLoading && (
            <div className="text-center py-8 text-gray-600">Looking up word...</div>
          )}

          {error && (
            <div className="text-center py-8 text-red-600">
              Error: {error instanceof Error ? error.message : 'Unknown error'}
            </div>
          )}

          {wordData && (
            <WordResultCard data={wordData} onClear={handleClear} clearing={clearing} />
          )}

          {currentWord && !isLoading && !error && !wordData && (
            <div className="text-center py-8 text-gray-600">
              No data found for &quot;{currentWord}&quot;
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
