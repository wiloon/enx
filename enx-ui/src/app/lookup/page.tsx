'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { apiService } from '@/services/api'
import { WordData } from '@/types'

export default function WordLookupPage() {
  const [searchWord, setSearchWord] = useState('')
  const [currentWord, setCurrentWord] = useState('')

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

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch(e)
    }
  }

  return (
    <div className="container mx-auto p-6 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>Word Lookup</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <form onSubmit={handleSearch} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="word-input">Enter English word</Label>
              <Input
                id="word-input"
                type="text"
                value={searchWord}
                onChange={(e) => setSearchWord(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Type a word to look up..."
                className="text-lg"
              />
            </div>
            <Button type="submit" className="w-full">
              Look Up
            </Button>
          </form>

          {isLoading && (
            <div className="text-center py-8">
              <div className="text-gray-600">Looking up word...</div>
            </div>
          )}

          {error && (
            <div className="text-center py-8">
              <div className="text-red-600">
                Error: {error instanceof Error ? error.message : 'Unknown error'}
              </div>
            </div>
          )}

          {wordData && (
            <Card>
              <CardHeader>
                <CardTitle className="text-2xl">{wordData.English}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-sm font-medium text-gray-600">
                      Chinese Translation
                    </Label>
                    <div className="text-lg font-medium">{wordData.Chinese}</div>
                  </div>
                  
                  <div>
                    <Label className="text-sm font-medium text-gray-600">
                      IPA Pronunciation
                    </Label>
                    <div className="text-lg font-mono">{wordData.Pronunciation}</div>
                  </div>
                  
                  <div>
                    <Label className="text-sm font-medium text-gray-600">
                      Lookup Count
                    </Label>
                    <div className="text-lg">{wordData.LoadCount}</div>
                  </div>
                  
                  <div>
                    <Label className="text-sm font-medium text-gray-600">
                      Status
                    </Label>
                    <div className="text-lg">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          wordData.AlreadyAcquainted === 1
                            ? 'bg-green-100 text-green-800'
                            : 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {wordData.AlreadyAcquainted === 1 ? 'Mastered' : 'Learning'}
                      </span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {currentWord && !isLoading && !error && !wordData && (
            <div className="text-center py-8">
              <div className="text-gray-600">No data found for "{currentWord}"</div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}