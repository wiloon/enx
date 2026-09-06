import { useCallback, useEffect, useState } from 'react'
import {
  getWordHighlightEnabled,
  setWordHighlightEnabled,
  onWordHighlightEnabledChange,
} from '@/config/preferences'

// "Highlight vocabulary while reading" toggle state, shared by the options
// page and the popup. Loads the current value, stays in sync with the other
// surface via chrome.storage.onChanged, and exposes a setter that persists.
export const useWordHighlightEnabled = () => {
  const [enabled, setEnabled] = useState(true)

  useEffect(() => {
    let alive = true
    getWordHighlightEnabled().then(value => {
      if (alive) setEnabled(value)
    })
    const unsubscribe = onWordHighlightEnabledChange(value => {
      if (alive) setEnabled(value)
    })
    return () => {
      alive = false
      unsubscribe()
    }
  }, [])

  const update = useCallback(async (value: boolean) => {
    setEnabled(value) // optimistic; onChanged confirms (and setter swallows errors)
    await setWordHighlightEnabled(value)
  }, [])

  return { enabled, setEnabled: update }
}
