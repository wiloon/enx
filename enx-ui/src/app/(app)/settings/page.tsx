'use client'

import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { apiService } from '@/services/api'
import type { PreferencesData } from '@/types'

const PREFERENCES_KEY = ['preferences']

// Settings that live on the server (ADR-044), so the Chrome extension shows
// the same values. Today: the AI fallback for words the dictionaries don't
// have (ADR-045).
export default function SettingsPage() {
  const queryClient = useQueryClient()

  const { data, isLoading, error } = useQuery({
    queryKey: PREFERENCES_KEY,
    queryFn: async () => {
      const resp = await apiService.getPreferences()
      if (resp.success && resp.data) return resp.data
      throw new Error(resp.error || 'Failed to load settings')
    },
  })

  const save = useMutation({
    mutationFn: async (enabled: boolean) => {
      const resp = await apiService.updatePreferences({
        aiWordFallback: enabled,
      })
      if (resp.success && resp.data) return resp.data
      throw new Error(resp.error || 'Could not save the setting')
    },
    // The server answers with the full set, so show exactly what it holds
    // rather than what we assume it holds.
    onSuccess: (next: PreferencesData) =>
      queryClient.setQueryData(PREFERENCES_KEY, next),
    // After a failure the switch must show what is really stored.
    onError: () => queryClient.invalidateQueries({ queryKey: PREFERENCES_KEY }),
  })

  const aiFallback = data?.aiWordFallback
  // While a save is in flight show the value being saved, so the switch
  // responds immediately; it settles on the server's answer.
  const checked = save.isPending
    ? (save.variables ?? false)
    : (aiFallback?.effective ?? false)

  return (
    <div className="container mx-auto p-6 max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle>AI word lookup</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading && <p className="text-muted-foreground">Loading...</p>}
          {error && (
            <p className="text-destructive">
              {error instanceof Error
                ? error.message
                : 'Failed to load settings'}
            </p>
          )}

          {aiFallback && (
            <>
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="ai-word-fallback">
                  Look up unknown words with AI automatically
                </Label>
                <Switch
                  id="ai-word-fallback"
                  checked={checked}
                  disabled={!aiFallback.editable || save.isPending}
                  onCheckedChange={(next) => save.mutate(next)}
                />
              </div>

              <p className="text-sm text-muted-foreground">
                When a word isn&apos;t in the dictionary, Catglish can look it
                up with AI. Only the word itself is sent to an AI provider,
                never the sentence or the page. Each AI lookup uses credits.
                This setting also applies in the Catglish extension.
              </p>

              {!aiFallback.editable && (
                <p className="text-sm">
                  AI lookup is available with a subscription or a credit
                  balance.{' '}
                  <Link href="/billing" className="underline">
                    Subscribe or buy credits
                  </Link>
                </p>
              )}

              {save.isError && (
                <p role="alert" className="text-sm text-destructive">
                  {save.error instanceof Error
                    ? save.error.message
                    : 'Could not save the setting'}
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
