// Content-script edge for hover sentence translation (ADR-068): resolve a
// pointer sample to a sentence, drive the lib rules, paint the button/wash,
// and send the sentence on click. Events are bound by content.tsx.

import {
  HOVER_SENTENCE_HIGHLIGHT_NAME,
  sentenceWordStates,
} from '@/lib/wordHighlight'
import { WordProcessor } from '@/lib/wordProcessor'
import {
  createHoverSentenceRules,
  pointInSentenceRects,
  sameSentence,
  type HoverSentenceRules,
  type SentenceIdentity,
} from '@/lib/hoverSentenceTranslate'
import {
  getHoverSentenceTranslateEnabled,
  getHoverSentenceShadeEnabled,
  onHoverSentenceTranslateEnabledChange,
  onHoverSentenceShadeEnabledChange,
} from '@/config/preferences'
import { LOOKUP_FAILED_MESSAGE } from '@/lib/extensionContext'
import {
  mountSentenceTranslateButton,
  type OverlayElement,
} from './sentenceTranslateButton'
import type { Root } from 'react-dom/client'
import type { BackgroundResponse, WordData } from '@/types'

export type HoverSentenceDeps = {
  caretFromPoint: (
    x: number,
    y: number
  ) => { node: Node; offset: number } | null
  pointInRange: (range: Range, x: number, y: number) => boolean
  getLookupExclusions: () => readonly string[]
  getArticleRoots: () => readonly Element[]
  getWordCache: () => Record<string, WordData>
  recordReadingPosition: (range: Range) => void
  setActiveSentenceHighlight: (range: Range) => void
  showSelectionHint: (hint: string, reference: Range) => void
  sendOpenSentencePanel: (payload: {
    sentence: string
    wordStates: ReturnType<typeof sentenceWordStates>
  }) => Promise<BackgroundResponse>
  // ADR-095: anonymous mode shows Sign in instead of opening the panel.
  mayOpenSidePanel?: () => boolean
  showSignInInstead?: (range: Range) => void
  isCurrentArticle: () => boolean
  // Captures the account generation at click time; the returned checker is
  // consulted when the panel reply arrives.
  captureAccount: () => () => boolean
  mountShadowRoot: (host: HTMLElement) => Root
  now: () => number
}

type ResolvedTarget = {
  identity: SentenceIdentity
  range: Range
  sentence: string
}

const identityFromRange = (range: Range): SentenceIdentity => ({
  startContainer: range.startContainer,
  startOffset: range.startOffset,
  endContainer: range.endContainer,
  endOffset: range.endOffset,
})

const rectList = (range: Range): DOMRect[] => {
  const list = range.getClientRects()
  const out: DOMRect[] = []
  for (let i = 0; i < list.length; i++) out.push(list[i])
  return out
}

const selectionIsNonEmpty = () => {
  const selection = window.getSelection()
  return !!(
    selection &&
    !selection.isCollapsed &&
    selection.toString().trim()
  )
}

export type HoverSentenceSession = {
  containsOverlay: (node: Node | null) => boolean
  onArticleMouseMove: (event: MouseEvent) => void
  onArticleMouseLeave: () => void
  onDocumentMouseDown: (event: MouseEvent) => boolean
  // Clears pressed/selection suppression. When mayStartDwell, a selection-free
  // release inside an article root may start a fresh dwell.
  onDocumentMouseUp: (event: MouseEvent, mayStartDwell?: boolean) => void
  onSelectionChange: () => void
  onKeyDown: (event: KeyboardEvent) => void
  // Drop a pending openSentencePanel reply so a newer UI is not replaced.
  invalidatePendingFeedback: () => void
  dispose: () => void
  setTranslateEnabled: (enabled: boolean) => void
  setShadeEnabled: (enabled: boolean) => void
  start: () => void
}

export const createHoverSentenceSession = (
  deps: HoverSentenceDeps
): HoverSentenceSession => {
  const rules: HoverSentenceRules = createHoverSentenceRules()
  let translateEnabled = true
  let shadeEnabled = true
  let disposed = true
  // Dwell candidate / last resolve. Independent of the currently shown button.
  let cached: ResolvedTarget | null = null
  let shown: ResolvedTarget | null = null
  let overlay: OverlayElement | null = null
  let stopButton: (() => void) | null = null
  let rafId: number | null = null
  let pendingPoint: {
    x: number
    y: number
    node: Node
    buttons: number
  } | null = null
  let clickGeneration = 0
  let unsubTranslate: (() => void) | null = null
  let unsubShade: (() => void) | null = null
  let started = false
  let preferenceGeneration = 0
  let tickTimer: ReturnType<typeof setTimeout> | undefined

  const clearWash = () => {
    CSS.highlights.delete(HOVER_SENTENCE_HIGHLIGHT_NAME)
  }

  const paintWash = (range: Range) => {
    if (!shadeEnabled) {
      clearWash()
      return
    }
    CSS.highlights.set(HOVER_SENTENCE_HIGHLIGHT_NAME, new Highlight(range))
  }

  const hideOverlay = () => {
    if (stopButton) {
      stopButton()
      stopButton = null
    }
    overlay = null
    clearWash()
    shown = null
  }

  const showOverlay = (target: ResolvedTarget) => {
    hideOverlay()
    shown = target

    const handle = mountSentenceTranslateButton({
      className: 'enx-hover-sentence-translate-button',
      title: 'Translate sentence',
      ariaLabel: 'Translate sentence',
      reference: target.range,
      anchor: 'end',
      placement: 'last-character',
      mountShadowRoot: deps.mountShadowRoot,
      onTrigger: () => {
        void onButtonClick(target)
      },
      onMouseEnter: () => {
        rules.enterButton(deps.now())
        afterRules()
      },
      onMouseLeave: () => {
        rules.leaveButton(deps.now())
        afterRules()
      },
    })
    overlay = handle.overlay
    stopButton = handle.cleanup

    if (shadeEnabled) paintWash(target.range)
  }

  const syncVisible = () => {
    if (disposed || !translateEnabled) {
      hideOverlay()
      return
    }
    const v = rules.visible()
    if (!v) {
      hideOverlay()
      return
    }
    if (shown && sameSentence(shown.identity, v)) return
    if (cached && sameSentence(cached.identity, v)) {
      showOverlay(cached)
      return
    }
    // Visible identity without a matching cache: hide (should not happen).
    hideOverlay()
  }

  const afterRules = () => {
    syncVisible()
    clearTimeout(tickTimer)
    const deadline = rules.nextDeadline()
    if (deadline === null) return
    tickTimer = setTimeout(() => {
      rules.tick(deps.now())
      afterRules()
    }, Math.max(0, deadline - deps.now()))
  }

  const cancelQueuedPointer = () => {
    pendingPoint = null
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
  }

  const articleRootFor = (node: Node) =>
    deps.getArticleRoots().find(root => root.isConnected && root.contains(node))

  const resolveAt = (
    x: number,
    y: number,
    node: Node,
    requireWord: boolean
  ): ResolvedTarget | null => {
    const root = articleRootFor(node)
    if (!root) return null
    const caret = deps.caretFromPoint(x, y)
    const exclusions = deps.getLookupExclusions()
    if (
      WordProcessor.isInExcludedSubtree(node, undefined, exclusions) ||
      (caret &&
        (!root.contains(caret.node) ||
          WordProcessor.isInExcludedSubtree(caret.node, undefined, exclusions)))
    ) {
      return null
    }
    // Use live range geometry. A release must land on a word, even when its
    // coordinates are within the cached sentence.
    if (!requireWord) {
      for (const target of [cached, shown]) {
        if (
          target &&
          root.contains(target.range.startContainer) &&
          root.contains(target.range.endContainer) &&
          !target.range.collapsed &&
          sameSentence(target.identity, identityFromRange(target.range)) &&
          pointInSentenceRects(rectList(target.range), x, y)
        ) {
          return target
        }
      }
    }
    if (!caret) return null
    const wordRange = WordProcessor.expandToWordRange(
      caret.node,
      caret.offset,
      exclusions
    )
    if (!wordRange) return null
    if (!deps.pointInRange(wordRange, x, y)) return null

    const ctx = WordProcessor.extractSentenceContext(
      wordRange,
      wordRange.toString()
    )
    if (
      !ctx?.range ||
      ctx.range.collapsed ||
      !root.contains(ctx.range.startContainer) ||
      !root.contains(ctx.range.endContainer)
    ) {
      return null
    }
    const text = ctx.sentence?.trim()
    if (!text) return null
    const rects = rectList(ctx.range)
    if (rects.length === 0) return null
    // Geometry must be usable for anchoring (at least one non-empty rect).
    if (!rects.some(r => r.width > 0 || r.height > 0)) return null

    return {
      identity: identityFromRange(ctx.range),
      range: ctx.range,
      sentence: text,
    }
  }

  const syncLiveGestures = (buttons?: number) => {
    const now = deps.now()
    if (buttons !== undefined) {
      rules.setPressed(buttons !== 0, now)
    }
    rules.setSelectionNonEmpty(selectionIsNonEmpty(), now)
  }

  const applyPointer = (
    x: number,
    y: number,
    node: Node,
    requireWord = false,
    buttons?: number
  ) => {
    if (disposed || !translateEnabled) return
    syncLiveGestures(buttons)
    const now = deps.now()
    const target = resolveAt(x, y, node, requireWord)
    if (target) {
      cached = target
      rules.pointerAt(target.identity, now)
    } else {
      rules.pointerAt(null, now)
    }
    afterRules()
  }

  const flushRaf = () => {
    rafId = null
    if (!pendingPoint || disposed) return
    const { x, y, node, buttons } = pendingPoint
    pendingPoint = null
    applyPointer(x, y, node, false, buttons)
  }

  const onArticleMouseMove = (event: MouseEvent) => {
    if (disposed || !translateEnabled) return
    // Keep suppression aligned with the live button/selection even after a
    // session reset that cleared rules state.
    syncLiveGestures(event.buttons)
    pendingPoint = {
      x: event.clientX,
      y: event.clientY,
      node: event.target as Node,
      buttons: event.buttons,
    }
    if (rafId !== null) return
    rafId = requestAnimationFrame(flushRaf)
  }

  // Article-root mousemove stops at the root boundary; leaving must clear the
  // pointer so grace can start (ADR-068).
  const onArticleMouseLeave = () => {
    if (disposed || !translateEnabled) return
    cancelQueuedPointer()
    rules.pointerAt(null, deps.now())
    afterRules()
  }

  const onButtonClick = async (target: ResolvedTarget) => {
    const generation = ++clickGeneration
    const accountStillCurrent = deps.captureAccount()
    rules.dismiss('click', deps.now())
    afterRules()

    // ADR-095: anonymous mode never opens the Side Panel.
    if (deps.mayOpenSidePanel && !deps.mayOpenSidePanel()) {
      deps.showSignInInstead?.(target.range)
      return
    }

    deps.recordReadingPosition(target.range)
    deps.setActiveSentenceHighlight(target.range)

    const response = await deps.sendOpenSentencePanel({
      sentence: target.sentence,
      wordStates: sentenceWordStates(target.sentence, deps.getWordCache()),
    })

    if (disposed || generation !== clickGeneration) return
    if (!deps.isCurrentArticle() || !accountStillCurrent()) return

    if (response.success && response.panelOpened) return
    if (response.success && !response.panelOpened) {
      deps.showSelectionHint(
        'Saved. Click or right-click the Catglish toolbar icon to view the sentence translation.',
        target.range
      )
      return
    }
    deps.showSelectionHint(LOOKUP_FAILED_MESSAGE, target.range)
  }

  const containsOverlay = (node: Node | null) =>
    !!(overlay && node && overlay.contains(node))

  // Returns true when the event was on the hover button (caller should skip
  // page gesture handlers).
  const onDocumentMouseDown = (event: MouseEvent): boolean => {
    if (containsOverlay(event.target as Node)) return true
    cancelQueuedPointer()
    rules.setPressed(true, deps.now())
    afterRules()
    return false
  }

  const onDocumentMouseUp = (event: MouseEvent, mayStartDwell = true) => {
    if (containsOverlay(event.target as Node)) return
    rules.setPressed(false, deps.now())
    const nonEmpty = selectionIsNonEmpty()
    rules.setSelectionNonEmpty(nonEmpty, deps.now())
    if (
      mayStartDwell &&
      !nonEmpty &&
      translateEnabled &&
      !disposed &&
      articleRootFor(event.target as Node)
    ) {
      // Fresh dwell from release coordinates even if the mouse stays still.
      applyPointer(event.clientX, event.clientY, event.target as Node, true)
    } else {
      afterRules()
    }
  }

  const onSelectionChange = () => {
    rules.setSelectionNonEmpty(selectionIsNonEmpty(), deps.now())
    afterRules()
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || disposed || !translateEnabled) return
    syncLiveGestures()
    if (rules.isSuppressed()) {
      cancelQueuedPointer()
      afterRules()
      return
    }
    // Resolve a queued sample before dismiss so Escape targets the latest
    // pointer sentence (ADR-068 Decision 12), then drop the frame.
    if (pendingPoint) {
      const { x, y, node } = pendingPoint
      cancelQueuedPointer()
      const target = resolveAt(x, y, node, false)
      if (target) cached = target
      rules.pointerAt(target?.identity ?? null, deps.now())
    } else {
      cancelQueuedPointer()
    }
    rules.dismiss('escape', deps.now())
    afterRules()
  }

  const invalidatePendingFeedback = () => {
    clickGeneration++
  }

  const setTranslateEnabled = (enabled: boolean) => {
    translateEnabled = enabled
    if (!enabled) {
      rules.reset()
      cached = null
      hideOverlay()
      clearTimeout(tickTimer)
      cancelQueuedPointer()
      return
    }
    // Re-enable with live selection/button state, not the cleared rules.
    syncLiveGestures()
    afterRules()
  }

  const setShadeEnabled = (enabled: boolean) => {
    shadeEnabled = enabled
    if (!enabled) {
      clearWash()
      return
    }
    if (shown) paintWash(shown.range)
  }

  const start = () => {
    disposed = false
    if (started) return
    started = true
    const generation = preferenceGeneration
    const watchPreference = (
      read: () => Promise<boolean>,
      subscribe: (handler: (value: boolean) => void) => () => void,
      apply: (value: boolean) => void
    ) => {
      let receivedChange = false
      const unsubscribe = subscribe(value => {
        if (generation !== preferenceGeneration) return
        receivedChange = true
        apply(value)
      })
      void read().then(value => {
        if (generation === preferenceGeneration && !receivedChange) apply(value)
      })
      return unsubscribe
    }

    unsubTranslate = watchPreference(
      getHoverSentenceTranslateEnabled,
      onHoverSentenceTranslateEnabledChange,
      setTranslateEnabled
    )
    unsubShade = watchPreference(
      getHoverSentenceShadeEnabled,
      onHoverSentenceShadeEnabledChange,
      setShadeEnabled
    )
  }

  const dispose = () => {
    disposed = true
    started = false
    preferenceGeneration++
    unsubTranslate?.()
    unsubShade?.()
    unsubTranslate = null
    unsubShade = null
    clearTimeout(tickTimer)
    cancelQueuedPointer()
    cached = null
    rules.reset()
    hideOverlay()
    clickGeneration++
  }

  return {
    containsOverlay,
    onArticleMouseMove,
    onArticleMouseLeave,
    onDocumentMouseDown,
    onDocumentMouseUp,
    onSelectionChange,
    onKeyDown,
    invalidatePendingFeedback,
    dispose,
    setTranslateEnabled,
    setShadeEnabled,
    start,
  }
}
