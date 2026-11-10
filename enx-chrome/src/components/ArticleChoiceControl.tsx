import { DocumentTextIcon } from '@heroicons/react/24/outline'
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
  'rounded-lg border border-brand/40 px-2.5 py-1 text-xs font-medium text-brand transition hover:bg-brand-muted active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50'

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
    // A row of the popup's settings group, which draws the frame.
    <section aria-label="Article area" className="space-y-2 px-3 py-2">
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-muted text-brand">
          <DocumentTextIcon className="h-[18px] w-[18px]" />
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block text-sm font-medium text-foreground">
            Article
          </span>
          <span className="block truncate text-[11px] text-muted-foreground">
            {manual
              ? pageOnly
                ? 'Your choice · This page only'
                : 'Your choice'
              : 'Automatic detection'}
          </span>
        </span>
        <button
          type="button"
          className={`shrink-0 ${actionClass}`}
          disabled={busy}
          onClick={() => void choose()}
        >
          Choose article
        </button>
      </div>
      {/* One small-print line under the row's text, Use automatic inline
          at its end, so a manual choice adds little height to the popup. */}
      {(manual || state.choice?.saved || state.choice?.missed) && (
        <p className="pl-11 text-[11px] leading-snug text-muted-foreground">
          {state.choice?.missed && (
            <span className="text-warning-foreground">
              Your saved choice could not be applied on this page.{' '}
            </span>
          )}
          {pageOnly && (
            <>
              This choice cannot be remembered. Reloading restores automatic
              detection.{' '}
            </>
          )}
          {(manual || state.choice?.saved) && (
            <button
              type="button"
              className="font-medium text-brand transition hover:underline active:opacity-70 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand disabled:opacity-50"
              disabled={busy}
              onClick={() => void handleUseAutomatic()}
            >
              Use automatic
            </button>
          )}
        </p>
      )}
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
            automatic detection found and the extension version, linked to your
            account. Never the page&apos;s text or title. You can change this in
            Options.
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
      {(error || state.error) && (
        <p role="alert" className="text-xs text-destructive">
          {error || state.error}
        </p>
      )}
    </section>
  )
}
