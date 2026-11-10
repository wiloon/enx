import { useEffect, useState } from 'react'
import { config } from '@/config/env'
import {
  getArticleChoiceSharing,
  setArticleChoiceSharing,
} from '@/config/preferences'
import {
  getArticleChoiceOnTab,
  sendPageActionOnTab,
  type PageActionResponse,
} from '@/lib/enableLearningMode'
import { articleChoiceAvailable } from '@/lib/siteAdapters'

// Asks the tab without injecting the content script (ADR-034 Decision 2).
function probe(tabId: number, url: string) {
  return getArticleChoiceOnTab(
    tabId,
    articleChoiceAvailable(new URL(url), {
      uiOrigins: config.uiOrigins,
      rssxOrigins: config.rssxOrigins,
    })
  )
}

const actionClass =
  'rounded-lg border border-brand/40 px-3 py-1.5 text-xs font-medium text-brand transition hover:bg-brand-muted active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50'

export default function ArticleChoiceControl({
  onModeChange,
}: {
  onModeChange: () => void
}) {
  const [tab, setTab] = useState<{ id: number; url: string }>()
  const [state, setState] = useState<PageActionResponse>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [asking, setAsking] = useState(false)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [active] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      })
      if (!active?.id || !active.url || !/^https?:\/\//.test(active.url)) return
      const response = await probe(active.id, active.url)
      if (!cancelled) {
        setTab({ id: active.id, url: active.url })
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
    if (!tab) return
    setBusy(true)
    setError(undefined)
    try {
      const response = await sendPageActionOnTab(tab.id, 'useAutomaticArticle')
      if (!response.success) throw new Error(response.error)
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Couldn't restore automatic detection."
      )
    } finally {
      try {
        setState(await probe(tab.id, tab.url))
      } catch {
        /* Keep the last known choice when the tab becomes unavailable. */
      }
      onModeChange()
      setBusy(false)
    }
  }
  // ADR-073: the first pick asks whether to share; an unanswered popup that
  // closes leaves nothing stored, so the next pick asks again.
  const choose = async (answer?: boolean) => {
    if (!tab) return
    setBusy(true)
    setError(undefined)
    try {
      if (answer !== undefined) {
        await setArticleChoiceSharing(answer)
        setAsking(false)
      } else if ((await getArticleChoiceSharing()) === null) {
        setAsking(true)
        return
      }
      const response = await sendPageActionOnTab(tab.id, 'chooseArticle')
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
      {asking && (
        <section
          aria-labelledby="article-choice-sharing-title"
          className="space-y-2 rounded-lg bg-muted px-3 py-2.5"
        >
          <p
            id="article-choice-sharing-title"
            className="text-xs font-medium text-foreground"
          >
            Share article choices?
          </p>
          <p className="text-xs text-muted-foreground">
            Sharing helps improve automatic detection. Each choice you confirm
            sends the cleaned page address, the article&apos;s selector, what
            automatic detection found and the extension version, linked to
            your account. Never the page&apos;s text or title. You can change
            this in Options.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className={actionClass}
              disabled={busy}
              onClick={() => void choose(true)}
            >
              Share
            </button>
            <button
              type="button"
              className={actionClass}
              disabled={busy}
              onClick={() => void choose(false)}
            >
              Don&apos;t share
            </button>
          </div>
        </section>
      )}
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
