import { useEffect, useState } from 'react'
import {
  afterRead,
  afterSave,
  explanationLanguageControl,
  openingState,
  saveStarted,
} from '@/lib/explanationLanguage'
import {
  fetchPreferences,
  readCachedPreferences,
  updatePreferences,
} from '@/lib/serverPreferences'

// Shows the cached value at once, then reads the server's, so a change made
// on the website shows the next time (ADR-044 Decision 5).
export const useExplanationLanguage = () => {
  const [state, setState] = useState(() => openingState(null))

  useEffect(() => {
    let alive = true
    const load = async () => {
      const cached = await readCachedPreferences()
      if (!alive) return
      setState(openingState(cached))
      const result = await fetchPreferences()
      if (alive) setState(current => afterRead(current, result))
    }
    void load()
    return () => {
      alive = false
    }
  }, [])

  const control = explanationLanguageControl(state)

  const choose = async (value: string) => {
    if (!control || control.disabled || control.selected === value) return
    setState(current => saveStarted(current, value))
    const result = await updatePreferences({ explanationLanguage: value })
    setState(current => afterSave(current, result))
  }

  return { state, control, choose }
}
