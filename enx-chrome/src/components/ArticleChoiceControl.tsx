import { useEffect, useState } from 'react'
import {
  sendPageActionOnTab,
  type PageActionResponse,
} from '@/lib/enableLearningMode'

const actionClass =
  'rounded-lg border border-brand/40 px-3 py-1.5 text-xs font-medium text-brand transition hover:bg-brand-muted active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50'

export default function ArticleChoiceControl({
  onModeChange,
}: {
  onModeChange: () => void
}) {
  const [tabId, setTabId] = useState<number>()
  const [state, setState] = useState<PageActionResponse>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      })
      if (!tab?.id || !tab.url || !/^https?:\/\//.test(tab.url)) return
      const response = await sendPageActionOnTab(tab.id, 'getArticleChoice')
      if (!cancelled) {
        setTabId(tab.id)
        setState(response)
      }
    })().catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  if (!state?.available) return null
  const manual = state.choice?.source === 'your-choice'
  const pageOnly = manual && !state.choice?.saved
  const handleUseAutomatic = async () => {
    if (!tabId) return
    setBusy(true)
    setError(undefined)
    try {
      const response = await sendPageActionOnTab(tabId, 'useAutomaticArticle')
      if (!response.success) throw new Error(response.error)
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Couldn't restore automatic detection."
      )
    } finally {
      try {
        setState(await sendPageActionOnTab(tabId, 'getArticleChoice'))
      } catch {
        /* Keep the last known choice when the tab becomes unavailable. */
      }
      onModeChange()
      setBusy(false)
    }
  }
  const choose = async () => {
    if (!tabId) return
    setBusy(true)
    setError(undefined)
    try {
      const response = await sendPageActionOnTab(tabId, 'chooseArticle')
      if (!response.success) throw new Error(response.error)
      window.close()
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Couldn't start article selection."
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <section
      aria-label="Article area"
      className="space-y-2 rounded-xl bg-background px-3 py-2.5 ring-1 ring-border"
    >
      <p className="text-xs text-muted-foreground">
        {manual
          ? pageOnly
            ? 'Your choice · This page only'
            : 'Your choice'
          : 'Automatic detection'}
      </p>
      {state.choice?.missed && (
        <p className="text-xs text-warning-foreground">
          Your saved choice could not be applied on this page. Using automatic
          detection.
        </p>
      )}
      {pageOnly && (
        <p className="text-xs text-muted-foreground">
          This choice cannot be remembered or applied to other pages. Reloading
          restores automatic detection.
        </p>
      )}
      <button
        type="button"
        className={actionClass}
        disabled={busy}
        onClick={() => void choose()}
      >
        Choose article
      </button>
      {(manual || state.choice?.saved) && (
        <button
          type="button"
          className={actionClass}
          disabled={busy}
          onClick={() => void handleUseAutomatic()}
        >
          Use automatic
        </button>
      )}
      {(error || state.error) && (
        <p role="alert" className="text-xs text-destructive">
          {error || state.error}
        </p>
      )}
    </section>
  )
}
