import { useCallback, useEffect, useState } from 'react'
import {
  fetchPreferences,
  readCachedPreferences,
  updatePreferences,
  type PreferenceView,
} from '@/lib/serverPreferences'

export type AiWordFallbackState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  // The server could not be reached. `cached` is the last value it gave this
  // device (display only), or null when there is none.
  | { status: 'unavailable'; cached: PreferenceView | null }
  | { status: 'ready'; view: PreferenceView }

// The "look up unknown words with AI automatically" setting (ADR-044,
// ADR-045). The server holds the truth: this loads it, and after a save
// shows what the server answers rather than what was asked for.
export const useAiWordFallback = () => {
  const [state, setState] = useState<AiWordFallbackState>({ status: 'loading' })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetchPreferences().then(async result => {
      if (!alive) return
      if (result.ok) {
        setState({ status: 'ready', view: result.data.aiWordFallback })
      } else if (result.reason === 'signed-out') {
        setState({ status: 'signed-out' })
      } else {
        const cached = await readCachedPreferences()
        if (alive) {
          setState({
            status: 'unavailable',
            cached: cached?.aiWordFallback ?? null,
          })
        }
      }
    })
    return () => {
      alive = false
    }
  }, [])

  const setEnabled = useCallback(async (enabled: boolean) => {
    setSaving(true)
    setSaveError(null)
    const result = await updatePreferences({ aiWordFallback: enabled })
    if (result.ok) {
      setState({ status: 'ready', view: result.data.aiWordFallback })
    } else {
      setSaveError(result.error)
    }
    setSaving(false)
  }, [])

  return { state, saving, saveError, setEnabled }
}
