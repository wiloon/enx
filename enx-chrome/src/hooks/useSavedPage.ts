import { useEffect, useState } from 'react'
import { saveOutcome } from '@/lib/pageSave'
import {
  findSavedPage,
  forgetSavedPage,
  rememberSavedPage,
  savedPageKey,
  type SavedPageRef,
} from '@/lib/savedPagesStore'

// The popup's save card (ADR-032 Decision 4/4a). One click saves the tab's
// link and title, one click removes it. Whether the tab is already saved is
// read from this browser's local copy, so opening the popup never sends the
// tab's address anywhere.

export interface SaveableTab {
  url: string
  title: string
}

export function useSavedPage(userId: string | undefined) {
  // null: the active tab is not a web page, so there is nothing to offer.
  const [tab, setTab] = useState<SaveableTab | null>(null)
  const [saved, setSaved] = useState<SavedPageRef | null>(null)
  const [busy, setBusy] = useState<'saving' | 'removing' | null>(null)
  const [error, setError] = useState<string | undefined>()

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    ;(async () => {
      const [active] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      })
      if (!active?.url || !savedPageKey(active.url)) return
      const known = await findSavedPage(userId, active.url)
      if (cancelled) return
      setTab({ url: active.url, title: active.title ?? '' })
      setSaved(known)
    })().catch(err => console.error('saved page lookup failed:', err))
    return () => {
      cancelled = true
    }
  }, [userId])

  const save = async () => {
    if (!userId || !tab || busy) return
    setBusy('saving')
    setError(undefined)
    try {
      const outcome = saveOutcome(
        await chrome.runtime.sendMessage({ type: 'savePage', savedPage: tab })
      )
      if (outcome.ok) {
        await rememberSavedPage(userId, tab.url, outcome.page)
        setSaved(outcome.page)
      } else {
        setError(
          outcome.errorMessage ||
            "Couldn't save this link. Try again in a moment."
        )
      }
    } catch {
      setError("Couldn't save this link. Try again in a moment.")
    } finally {
      setBusy(null)
    }
  }

  const remove = async () => {
    if (!userId || !saved || busy) return
    setBusy('removing')
    setError(undefined)
    try {
      const result = await chrome.runtime.sendMessage({
        type: 'removeSavedPage',
        savedPageId: saved.id,
      })
      // 404: already removed elsewhere (e.g. on the website); the local copy
      // was just stale, and the user's intent holds either way.
      if (result?.success || result?.status === 404) {
        await forgetSavedPage(userId, saved.id)
        setSaved(null)
      } else {
        setError(
          result?.error || "Couldn't remove this link. Try again in a moment."
        )
      }
    } catch {
      setError("Couldn't remove this link. Try again in a moment.")
    } finally {
      setBusy(null)
    }
  }

  return { tab, saved, busy, error, save, remove }
}
