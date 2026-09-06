'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { apiService } from '@/services/api'
import { RephraseData } from '@/types'

const MAX_CHARS = 200

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
    >
      {copied ? 'Copied' : 'Copy'}
    </Button>
  )
}

export default function RephrasePage() {
  const [input, setInput] = useState('')

  const mutation = useMutation<RephraseData, Error, string>({
    mutationFn: async (text: string) => {
      const response = await apiService.rephrase(text)
      if (!response.success || !response.data) {
        throw new Error(response.error || 'Rephrase failed')
      }
      return response.data
    },
  })

  // Count Unicode code points, matching the backend's rune-based cap.
  const charCount = [...input].length
  const tooLong = charCount > MAX_CHARS
  const canSubmit = input.trim().length > 0 && !tooLong && !mutation.isPending

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (canSubmit) mutation.mutate(input.trim())
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Skip Enter presses that are confirming an IME candidate (e.g. pinyin),
    // not actually submitting the form.
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (canSubmit) mutation.mutate(input.trim())
    }
  }

  const result = mutation.data

  return (
    <div className="container mx-auto p-6 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>Idiomatic Phrasing</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <form onSubmit={handleSubmit} className="space-y-2">
            <Label htmlFor="rephrase-input">
              Type in Chinese or rough English
            </Label>
            <textarea
              id="rephrase-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={4}
              placeholder="What do you want to say?"
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="flex items-center justify-between">
              <span
                className={`text-xs ${tooLong ? 'text-red-600' : 'text-gray-500'}`}
              >
                {charCount} / {MAX_CHARS}
              </span>
              <Button type="submit" disabled={!canSubmit}>
                {mutation.isPending ? 'Rephrasing…' : 'Rephrase'}
              </Button>
            </div>
          </form>

          {mutation.isError && (
            <div className="text-sm text-red-600">
              {mutation.error.message}
            </div>
          )}

          {result && (
            <div className="space-y-6">
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-lg font-medium">{result.idiomatic}</p>
                  <CopyButton text={result.idiomatic} />
                </div>
              </div>

              {result.alternatives.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-gray-700">
                    Alternatives
                  </h3>
                  {result.alternatives.map((alt, i) => (
                    <div
                      key={i}
                      className="flex items-start justify-between gap-3"
                    >
                      <div className="space-y-1">
                        <Badge variant="secondary">{alt.register}</Badge>
                        <p>{alt.text}</p>
                      </div>
                      <CopyButton text={alt.text} />
                    </div>
                  ))}
                </div>
              )}

              {result.notes.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-gray-700">Notes</h3>
                  <ul className="list-disc space-y-1 pl-5 text-sm text-gray-600">
                    {result.notes.map((note, i) => (
                      <li key={i}>{note}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
