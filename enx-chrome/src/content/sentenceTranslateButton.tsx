// Shared round translate-button mount used by selection (ADR-007) and hover
// (ADR-068 Decision 1). Each caller keeps its own overlay slot and cleanup.

import type { Root } from 'react-dom/client'
import { autoUpdate } from '@floating-ui/dom'
import { positionSelectionHint } from '@/lib/overlayPositioning'
import { nearestElement } from '@/lib/rangeUtils'
import SidePanelTranslateIcon from '@/components/icons/SidePanelTranslateIcon'

export type OverlayElement = HTMLElement & {
  popover: 'manual' | 'auto' | ''
  showPopover: () => void
  hidePopover: () => void
}

export type SentenceTranslateButtonOptions = {
  className: string
  title: string
  ariaLabel: string
  reference: Range
  // Which client rect anchors the button: selection may use the start for a
  // backward drag; hover always uses the sentence's last line.
  anchor: 'start' | 'end'
  placement: 'top-start' | 'bottom-end' | 'right'
  sentenceContainer?: Element | null
  mountShadowRoot: (host: HTMLElement) => Root
  onTrigger: () => void
  onMouseEnter?: () => void
  onMouseLeave?: () => void
  // Selection registers Escape on the document; hover dismisses globally.
  onEscape?: () => void
}

export type SentenceTranslateButtonHandle = {
  overlay: OverlayElement
  cleanup: () => void
}

// Look at the first visible text after the sentence, including inline siblings.
const followingTextRect = (
  sentence: Range,
  container: Element
): DOMRect | null => {
  const end = sentence.endContainer
  if (!(end instanceof Text) || !container.contains(end)) return null

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  walker.currentNode = end
  const probe = document.createRange()
  for (let node: Node | null = end; node; node = walker.nextNode()) {
    const text = node as Text
    const start = node === end ? sentence.endOffset : 0
    const offset = text.data.slice(start).search(/[^\s\x85]/)
    if (offset < 0) continue
    probe.setStart(text, start + offset)
    probe.setEnd(text, start + offset + 1)
    const rect = probe.getClientRects()[0]
    if (rect?.width && rect.height) return rect
  }
  return null
}

export const mountSentenceTranslateButton = (
  options: SentenceTranslateButtonOptions
): SentenceTranslateButtonHandle => {
  const host = document.createElement('div') as OverlayElement
  host.popover = 'manual'
  host.className = options.className
  host.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    padding: 0;
    border: none;
    background: transparent;
    margin: 0;
  `

  const root = options.mountShadowRoot(host)
  root.render(
    <button
      type="button"
      onClick={options.onTrigger}
      onMouseEnter={options.onMouseEnter}
      onMouseLeave={options.onMouseLeave}
      className="flex items-center justify-center h-7 w-7 rounded-full cursor-pointer bg-brand text-brand-foreground shadow-md hover:bg-brand/90 active:scale-[0.97] active:brightness-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      title={options.title}
      aria-label={options.ariaLabel}
    >
      <SidePanelTranslateIcon className="h-4 w-4" />
    </button>
  )

  document.body.appendChild(host)
  host.showPopover()

  const reference = options.reference
  const virtualReference = {
    getBoundingClientRect: () => {
      const rects = reference.getClientRects()
      const usableRects = Array.from(rects).filter(
        rect => rect.width > 0 || rect.height > 0
      )
      const anchor =
        options.anchor === 'start' ? usableRects[0] : usableRects.at(-1)
      return anchor ?? reference.getBoundingClientRect()
    },
    getClientRects: () => reference.getClientRects(),
    contextElement: nearestElement(reference.startContainer) ?? undefined,
  }
  const update = () => {
    let placement: typeof options.placement | 'top-end' = options.placement
    if (placement === 'right' && options.sentenceContainer) {
      const last = virtualReference.getBoundingClientRect()
      const next = followingTextRect(reference, options.sentenceContainer)
      if (next && next.top < last.bottom && next.bottom > last.top) {
        placement = 'top-end'
      }
    }
    void positionSelectionHint(virtualReference, host, placement)
  }
  const stopPositioning = autoUpdate(virtualReference, host, update)

  const handleKeydown = options.onEscape
    ? (e: KeyboardEvent) => {
        if (e.key === 'Escape') options.onEscape!()
      }
    : null
  if (handleKeydown) document.addEventListener('keydown', handleKeydown)

  return {
    overlay: host,
    cleanup: () => {
      if (handleKeydown) document.removeEventListener('keydown', handleKeydown)
      stopPositioning()
      root.unmount()
      host.remove()
    },
  }
}
