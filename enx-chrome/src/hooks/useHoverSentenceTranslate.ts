import { useCallback, useEffect, useState } from 'react'
import {
  getHoverSentenceTranslateEnabled,
  setHoverSentenceTranslateEnabled,
  onHoverSentenceTranslateEnabledChange,
  getHoverSentenceShadeEnabled,
  setHoverSentenceShadeEnabled,
  onHoverSentenceShadeEnabledChange,
} from '@/config/preferences'

// Options-page state for the hover sentence-translate switches (ADR-068).
export const useHoverSentenceTranslate = () => {
  const [translateEnabled, setTranslateEnabled] = useState(true)
  const [shadeEnabled, setShadeEnabled] = useState(true)

  useEffect(() => {
    let alive = true
    getHoverSentenceTranslateEnabled().then(value => {
      if (alive) setTranslateEnabled(value)
    })
    getHoverSentenceShadeEnabled().then(value => {
      if (alive) setShadeEnabled(value)
    })
    const unsubTranslate = onHoverSentenceTranslateEnabledChange(value => {
      if (alive) setTranslateEnabled(value)
    })
    const unsubShade = onHoverSentenceShadeEnabledChange(value => {
      if (alive) setShadeEnabled(value)
    })
    return () => {
      alive = false
      unsubTranslate()
      unsubShade()
    }
  }, [])

  const updateTranslate = useCallback(async (value: boolean) => {
    setTranslateEnabled(value)
    await setHoverSentenceTranslateEnabled(value)
  }, [])

  const updateShade = useCallback(async (value: boolean) => {
    setShadeEnabled(value)
    await setHoverSentenceShadeEnabled(value)
  }, [])

  return {
    translateEnabled,
    setTranslateEnabled: updateTranslate,
    shadeEnabled,
    setShadeEnabled: updateShade,
  }
}
