// Coming back to a book (ADR-081 Decision 3, #897): when learning mode turns
// on, a book with a reading position gets a corner prompt. Clicking it finds
// the sentence in the article as it is now, scrolls there and highlights it (ADR-084); it
// never opens the side panel. The prompt goes once it is clicked, dismissed,
// or a new sentence on this page becomes the position. The DOM side is the
// view, passed in.

import { readArticleText } from '@/lib/articleText'
import { findReadingAnchor } from '@/lib/readingAnchor'
import type { ReadingAnchor } from '@/lib/readingPositions'

export const PREVIEW_CHARS = 80

export const NOT_FOUND_NOTICE =
  "Couldn't find your last sentence on this page. This is about where it was."
export const NOT_SAVED_NOTICES = {
  'storage-full':
    "Your reading position wasn't saved: Catglish's storage for reading positions is full.",
  'write-failed': "Your reading position wasn't saved.",
} as const

export type NotSavedCode = keyof typeof NOT_SAVED_NOTICES

export type ReadingPositionOpenMessage = {
  type: 'openReadingPosition'
  bookKey: string
}

/** A failure is red; a missing sentence is only a warning. */
export type NoticeTone = 'failure' | 'warning'

export interface ReadingPositionView {
  showPrompt(preview: string, actions: { jump(): void; dismiss(): void }): void
  hidePrompt(): void
  showNotice(text: string, tone: NoticeTone): void
  /** Scrolls `range` into view; highlights it only when it is the sentence. */
  reveal(range: Range, highlight: boolean): void
}

export interface ReadingPositionResumeDeps {
  send: (message: ReadingPositionOpenMessage) => Promise<unknown>
  view: ReadingPositionView
}

/** The start of the sentence, as the prompt shows it. */
export const promptPreview = (sentence: string) =>
  sentence.length <= PREVIEW_CHARS
    ? sentence
    : `${sentence.slice(0, PREVIEW_CHARS).trimEnd()}…`

const positionOf = (reply: unknown): ReadingAnchor | null => {
  const r = reply as { ok?: boolean; position?: ReadingAnchor | null } | null
  return r?.ok === true && r.position ? r.position : null
}

export function createReadingPositionResume(deps: ReadingPositionResumeDeps) {
  const { view } = deps
  // Bumped whenever the prompt must go, so an open still in flight shows
  // nothing afterwards.
  let generation = 0
  let notSavedShown = false

  const hide = () => {
    generation++
    view.hidePrompt()
  }

  const jump = (article: readonly Element[], position: ReadingAnchor) => {
    hide()
    const text = readArticleText(article)
    const found = findReadingAnchor(text.text, position)
    const end = found.found ? found.offset + position.sentence.length : 0
    const range = found.found
      ? text.rangeOf(found.offset, end)
      : text.rangeOf(
          Math.min(found.offset, text.text.length - 1),
          text.text.length
        )
    if (range) view.reveal(range, found.found)
    if (!found.found || !range) view.showNotice(NOT_FOUND_NOTICE, 'warning')
  }

  return {
    /**
     * Learning mode turned on over `article`: asks the writer for the book's
     * position, which also makes the book the most recent, and offers it.
     */
    async open(bookKey: string | null, article: readonly Element[]) {
      hide()
      if (!bookKey || article.length === 0) return
      const current = generation
      const position = positionOf(
        await deps.send({ type: 'openReadingPosition', bookKey })
      )
      if (!position || current !== generation) return
      view.showPrompt(promptPreview(position.sentence), {
        jump: () => jump(article, position),
        dismiss: hide,
      })
    },

    /** A new sentence on this page is the position now. */
    recorded: hide,

    /** Learning mode is off on this page. */
    close: hide,

    /** A write failed; the user hears it once per page session. */
    notSaved(code: NotSavedCode) {
      if (notSavedShown) return
      notSavedShown = true
      view.showNotice(NOT_SAVED_NOTICES[code], 'failure')
    },
  }
}
