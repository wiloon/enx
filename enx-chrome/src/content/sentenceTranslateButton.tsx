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
      className="flex items-center justify-center h-7 w-7 rounded-full bg-brand hover:bg-brand/90 text-brand-foreground shadow-md"
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
      if (rects.length === 0) return reference.getBoundingClientRect()
      return options.anchor === 'start' ? rects[0] : rects[rects.length - 1]
    },
    getClientRects: () => reference.getClientRects(),
    contextElement: nearestElement(reference.startContainer) ?? undefined,
  }
  const update = () => {
    void positionSelectionHint(virtualReference, host, options.placement)
  }
  const stopPositioning = autoUpdate(virtualReference, host, update)
  update()

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
