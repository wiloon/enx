import {
  createArticleChoice,
  createArticlePickSession,
} from '@/lib/articleChoice'
import {
  articleSelector,
  isPickable,
  startArticlePicker,
  showArticleChoiceNotice,
} from './articlePicker'

function localArticleChoice(
  doc: Document,
  storage: Pick<chrome.storage.StorageArea, 'get' | 'set' | 'remove'>
) {
  const key = `articleChoice:${doc.location.hostname}`
  return createArticleChoice<Element>({
    read: async () => {
      const value = (await storage.get(key))?.[key]
      return typeof value === 'string' && value.length > 0 ? value : null
    },
    write: async selector => {
      if (selector === null) await storage.remove(key)
      else await storage.set({ [key]: selector })
    },
    resolve: selector => {
      try {
        return Array.from(doc.querySelectorAll(selector))
      } catch {
        return []
      }
    },
    selectorFor: articleSelector,
    isEligible: isPickable,
  })
}

// Owns the browser-side lifetime of a choice. The content script supplies
// the existing learning-mode flow; picker and storage details stay here.
export function createPageArticleChoice(deps: {
  document: Document
  storage: Pick<chrome.storage.StorageArea, 'get' | 'set' | 'remove'>
  available: () => boolean
  mode: { isOn: () => boolean; stop: () => void; enable: () => Promise<void> }
}) {
  const choice = localArticleChoice(deps.document, deps.storage)
  let error: string | undefined
  const ready = choice.load().catch(() => {
    error =
      "Couldn't read your saved article choice. Using automatic detection."
  })
  const session = createArticlePickSession({
    mode: deps.mode,
    confirm: choice.confirm,
    useAutomatic: choice.useAutomatic,
  })
  let stopPicker: (() => void) | null = null
  let clearNotice: (() => void) | null = null
  let busy = false
  let operation = 0
  const current = () => (deps.available() ? choice.current() : null)
  const abandon = () => {
    operation++
    busy = false
    stopPicker?.()
    stopPicker = null
    session.abandon()
    clearNotice?.()
    clearNotice = null
  }
  const finish = async (action: () => Promise<void>, confirmed = false) => {
    const pending = ++operation
    busy = true
    stopPicker?.()
    stopPicker = null
    error = undefined
    clearNotice?.()
    try {
      await action()
      if (pending !== operation) return
      if (confirmed) {
        const message = choice.current().saved
          ? 'Your article choice is remembered for this site.'
          : 'This page only: your choice cannot be remembered or applied to other pages. Reloading restores automatic detection.'
        clearNotice = showArticleChoiceNotice(deps.document, message)
      }
    } catch (cause) {
      if (pending !== operation) return
      error =
        cause instanceof Error
          ? cause.message
          : "Couldn't apply your article choice."
      await session.cancel().catch(() => {})
      if (pending === operation)
        clearNotice = showArticleChoiceNotice(deps.document, error, true)
    } finally {
      if (pending === operation) busy = false
    }
  }
  const unavailable = () => ({
    success: false,
    error: busy
      ? 'Please wait for your article choice to finish applying.'
      : 'Article selection is not available on this page.',
  })
  return {
    ready,
    current,
    abandon,
    async status() {
      await ready
      const state = current()
      return {
        success: true,
        available: deps.available(),
        picking: stopPicker !== null || busy,
        error,
        choice: state && {
          source: state.source,
          saved: state.saved,
          missed: state.missed,
        },
      }
    },
    async start() {
      await ready
      if (busy || !deps.available()) return unavailable()
      try {
        if (!stopPicker) {
          error = undefined
          clearNotice?.()
          session.begin()
          stopPicker = startArticlePicker({
            document: deps.document,
            confirm: node => {
              void finish(() => session.confirm(node), true)
            },
            cancel: () => {
              void finish(() => session.cancel())
            },
          })
        }
        return { success: true }
      } catch (cause) {
        await finish(() => session.cancel())
        return {
          success: false,
          error:
            cause instanceof Error
              ? cause.message
              : "Couldn't start article selection.",
        }
      }
    },
    async useAutomatic() {
      await ready
      if (busy || !deps.available()) return unavailable()
      await finish(() => session.useAutomatic())
      return { success: !error, error }
    },
  }
}
