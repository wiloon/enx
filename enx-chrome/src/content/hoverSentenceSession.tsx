// Content-script edge for hover sentence translation (ADR-068): resolve a
// pointer sample to a sentence, drive the lib rules, paint the button/wash,
// and send the sentence on click. Events are bound by content.tsx.

import type { Root } from 'react-dom/client'
import { autoUpdate } from '@floating-ui/dom'
import { positionSelectionHint } from '@/lib/overlayPositioning'
import { WordProcessor } from '@/lib/wordProcessor'
import {
  HOVER_SENTENCE_HIGHLIGHT_NAME,
  sentenceWordStates,
} from '@/lib/wordHighlight'
import { nearestElement } from '@/lib/rangeUtils'
import {
  DWELL_MS,
  GRACE_MS,
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
import SidePanelTranslateIcon from '@/components/icons/SidePanelTranslateIcon'
import type { BackgroundResponse, WordData } from '@/types'

type OverlayElement = HTMLElement & {
  popover: 'manual' | 'auto' | ''
  showPopover: () => void
  hidePopover: () => void
}

export type HoverSentenceDeps = {
  caretFromPoint: (
    x: number,
    y: number
  ) => { node: Node; offset: number } | null
  pointInRange: (range: Range, x: number, y: number) => boolean
  getLookupExclusions: () => readonly string[]
  getWordCache: () => Record<string, WordData>
  recordReadingPosition: (range: Range) => void
  setActiveSentenceHighlight: (range: Range) => void
  showSelectionHint: (hint: string, reference: Range) => void
  sendOpenSentencePanel: (payload: {
    sentence: string
    wordStates: ReturnType<typeof sentenceWordStates>
  }) => Promise<BackgroundResponse>
  isCurrentArticle: () => boolean
  mountShadowRoot: (host: HTMLElement) => Root
  now: () => number
}

type ResolvedTarget = {
  identity: SentenceIdentity
  range: Range
  sentence: string
  rects: DOMRect[]
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

export type HoverSentenceSession = {
  containsOverlay: (node: Node | null) => boolean
  onArticleMouseMove: (event: MouseEvent) => void
  onArticleMouseLeave: () => void
  onDocumentMouseDown: (event: MouseEvent) => boolean
  onDocumentMouseUp: (event: MouseEvent) => void
  onSelectionChange: () => void
  onKeyDown: (event: KeyboardEvent) => void
  dispose: () => void
  // For tests / enable path: apply prefs without waiting for storage events.
  setTranslateEnabled: (enabled: boolean) => void
  setShadeEnabled: (enabled: boolean) => void
  // Bind preference listeners and load initial values. Idempotent.
  start: () => void
}

export const createHoverSentenceSession = (
  deps: HoverSentenceDeps
): HoverSentenceSession => {
  const rules: HoverSentenceRules = createHoverSentenceRules()
  let translateEnabled = true
  let shadeEnabled = true
  let disposed = false
  let cached: ResolvedTarget | null = null
  let shown: ResolvedTarget | null = null
  let overlay: OverlayElement | null = null
  let overlayRoot: Root | null = null
  let stopPositioning: (() => void) | null = null
  let rafId: number | null = null
  let pendingPoint: { x: number; y: number } | null = null
  let clickGeneration = 0
  let unsubTranslate: (() => void) | null = null
  let unsubShade: (() => void) | null = null
  let started = false
  let tickTimers: ReturnType<typeof setTimeout>[] = []

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
    if (overlayRoot) {
      overlayRoot.unmount()
      overlayRoot = null
    }
    if (overlay) {
      overlay.remove()
      overlay = null
    }
    if (stopPositioning) {
      stopPositioning()
      stopPositioning = null
    }
    clearWash()
    shown = null
  }

  const showOverlay = (target: ResolvedTarget) => {
    if (
      shown &&
      sameSentence(identityFromRange(shown.range), target.identity)
    ) {
      // Same sentence: keep button; refresh wash if shading toggled on.
      if (shadeEnabled) paintWash(target.range)
      else clearWash()
      shown = target
      cached = target
      return
    }

    hideOverlay()
    shown = target
    cached = target

    const host = document.createElement('div') as OverlayElement
    host.popover = 'manual'
    host.className = 'enx-hover-sentence-translate-button'
    host.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      padding: 0;
      border: none;
      background: transparent;
      margin: 0;
    `

    const root = deps.mountShadowRoot(host)
    overlayRoot = root

    const handleClick = () => {
      void onButtonClick(target)
    }

    root.render(
      <button
        type="button"
        onClick={handleClick}
        onMouseEnter={() => rules.enterButton(deps.now())}
        onMouseLeave={() => {
          rules.leaveButton(deps.now())
          syncVisible()
        }}
        className="flex items-center justify-center h-7 w-7 rounded-full bg-brand hover:bg-brand/90 text-brand-foreground shadow-md"
        title="Translate sentence"
        aria-label="Translate sentence"
      >
        <SidePanelTranslateIcon className="h-4 w-4" />
      </button>
    )

    document.body.appendChild(host)
    host.showPopover()
    overlay = host

    const reference = target.range
    const virtualReference = {
      getBoundingClientRect: () => {
        const rects = reference.getClientRects()
        if (rects.length === 0) return reference.getBoundingClientRect()
        return rects[rects.length - 1]
      },
      getClientRects: () => reference.getClientRects(),
      contextElement: nearestElement(reference.startContainer) ?? undefined,
    }
    const update = () => {
      void positionSelectionHint(virtualReference, host, 'bottom-end')
    }
    stopPositioning = autoUpdate(virtualReference, host, update)
    update()

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
    if (cached && sameSentence(cached.identity, v)) {
      showOverlay(cached)
      return
    }
    // Visible identity without a matching cache: hide (should not happen).
    hideOverlay()
  }

  const clearTickTimers = () => {
    tickTimers.forEach(clearTimeout)
    tickTimers = []
  }

  // Re-arm the known dwell/grace deadlines after each pointer sample. tick()
  // is idempotent; extra fires are cheap.
  const armDeadlineTimers = () => {
    clearTickTimers()
    for (const delay of [DWELL_MS, GRACE_MS, DWELL_MS + GRACE_MS]) {
      tickTimers.push(
        setTimeout(() => {
          if (disposed) return
          rules.tick(deps.now())
          syncVisible()
        }, delay)
      )
    }
  }

  const afterRules = () => {
    syncVisible()
  }

  const resolveAt = (x: number, y: number): ResolvedTarget | null => {
    if (cached && pointInSentenceRects(cached.rects, x, y)) {
      return cached
    }

    const caret = deps.caretFromPoint(x, y)
    if (!caret) return null
    const wordRange = WordProcessor.expandToWordRange(
      caret.node,
      caret.offset,
      deps.getLookupExclusions()
    )
    if (!wordRange) return null
    if (!deps.pointInRange(wordRange, x, y)) return null

    const ctx = WordProcessor.extractSentenceContext(
      wordRange,
      wordRange.toString()
    )
    if (!ctx?.range) return null
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
      rects,
    }
  }

  const applyPointer = (x: number, y: number) => {
    if (disposed || !translateEnabled) return
    const now = deps.now()
    const target = resolveAt(x, y)
    if (target) {
      cached = target
      rules.pointerAt(target.identity, now)
    } else {
      rules.pointerAt(null, now)
    }
    armDeadlineTimers()
    afterRules()
  }

  const flushRaf = () => {
    rafId = null
    if (!pendingPoint || disposed) return
    const { x, y } = pendingPoint
    pendingPoint = null
    applyPointer(x, y)
  }

  const onArticleMouseMove = (event: MouseEvent) => {
    if (disposed || !translateEnabled) return
    pendingPoint = { x: event.clientX, y: event.clientY }
    if (rafId !== null) return
    rafId = requestAnimationFrame(flushRaf)
  }

  // Article-root mousemove stops at the root boundary; leaving must clear the
  // pointer so grace can start (ADR-068).
  const onArticleMouseLeave = () => {
    if (disposed || !translateEnabled) return
    pendingPoint = null
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    rules.pointerAt(null, deps.now())
    armDeadlineTimers()
    afterRules()
  }

  const onButtonClick = async (target: ResolvedTarget) => {
    const generation = ++clickGeneration
    rules.dismiss('click', deps.now())
    hideOverlay()
    clearWash()

    deps.recordReadingPosition(target.range)
    deps.setActiveSentenceHighlight(target.range)

    const response = await deps.sendOpenSentencePanel({
      sentence: target.sentence,
      wordStates: sentenceWordStates(target.sentence, deps.getWordCache()),
    })

    if (disposed || generation !== clickGeneration) return
    if (!deps.isCurrentArticle()) return

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
    rules.setPressed(true, deps.now())
    hideOverlay()
    return false
  }

  const onDocumentMouseUp = (event: MouseEvent) => {
    if (containsOverlay(event.target as Node)) return
    rules.setPressed(false, deps.now())
    const selection = window.getSelection()
    const nonEmpty = !!(
      selection &&
      !selection.isCollapsed &&
      selection.toString().trim()
    )
    rules.setSelectionNonEmpty(nonEmpty, deps.now())
    if (!nonEmpty && translateEnabled && !disposed) {
      // Fresh dwell from release coordinates even if the mouse stays still.
      applyPointer(event.clientX, event.clientY)
    } else {
      afterRules()
    }
  }

  const onSelectionChange = () => {
    const selection = window.getSelection()
    const nonEmpty = !!(
      selection &&
      !selection.isCollapsed &&
      selection.toString().trim()
    )
    rules.setSelectionNonEmpty(nonEmpty, deps.now())
    if (nonEmpty) hideOverlay()
    else afterRules()
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return
    rules.dismiss('escape', deps.now())
    hideOverlay()
  }

  const setTranslateEnabled = (enabled: boolean) => {
    translateEnabled = enabled
    if (!enabled) {
      rules.reset()
      hideOverlay()
      clearTickTimers()
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
        rafId = null
      }
      pendingPoint = null
    }
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
    void getHoverSentenceTranslateEnabled().then(v => {
      if (!disposed) setTranslateEnabled(v)
    })
    void getHoverSentenceShadeEnabled().then(v => {
      if (!disposed) setShadeEnabled(v)
    })
    unsubTranslate = onHoverSentenceTranslateEnabledChange(setTranslateEnabled)
    unsubShade = onHoverSentenceShadeEnabledChange(setShadeEnabled)
  }

  const dispose = () => {
    disposed = true
    started = false
    unsubTranslate?.()
    unsubShade?.()
    unsubTranslate = null
    unsubShade = null
    clearTickTimers()
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    pendingPoint = null
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
    dispose,
    setTranslateEnabled,
    setShadeEnabled,
    start,
  }
}
