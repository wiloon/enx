// Floating UI placement for the anchored overlay (the dictionary-lookup card
// and the drag-select hint). Kept out of content.tsx so it can be unit-tested
// against a fake platform -- jsdom has no layout.
import {
  computePosition,
  offset,
  flip,
  shift,
  size,
  hide,
  type Middleware,
  type Placement,
  type Platform,
  type VirtualElement,
} from '@floating-ui/dom'

// Gap kept between the overlay and the viewport edges. flip and size MUST use
// the same value: with flip at 0 and size at 8, a word 0-8px short of room
// stayed on top while size trimmed the card, and the trimmed card then
// "fit" on every later tick -- the card shrank into a scrollbar instead of
// flipping below the word.
export const OVERLAY_EDGE_PADDING = 8

// The overlay never takes more than this share of the viewport height.
export const OVERLAY_MAX_VIEWPORT_FRACTION = 0.6

const viewportCap = () =>
  Math.floor(window.innerHeight * OVERLAY_MAX_VIEWPORT_FRACTION)

// Hide the floating element while its reference is fully clipped (#523).
// visibility:hidden keeps the same DOM node and React state; hidePopover()
// would close and unmount.
export const applyReferenceHiddenVisibility = (
  overlay: HTMLElement,
  referenceHidden: boolean | undefined
): void => {
  overlay.style.visibility = referenceHidden ? 'hidden' : 'visible'
}

// Middleware shared by the word-lookup card. Exported so unit tests can lock
// that hide sits in the list (Floating UI middleware carries a `name`).
export const buildAnchoredOverlayMiddleware = (
  overlay: HTMLElement,
  gap: () => number
): Middleware[] => [
  offset(() => gap()),
  flip({ padding: OVERLAY_EDGE_PADDING }),
  shift({ padding: OVERLAY_EDGE_PADDING }),
  // Only shrinks the card when neither side has room for it (a short
  // window); the card's body then scrolls, its header and buttons stay.
  size({
    padding: OVERLAY_EDGE_PADDING,
    apply({ availableHeight }) {
      overlay.style.maxHeight = `${Math.min(viewportCap(), Math.floor(availableHeight))}px`
    },
  }),
  hide({ padding: OVERLAY_EDGE_PADDING }),
]

// One positioning pass; autoUpdate calls it on every scroll/resize tick.
// `gap` is the distance kept from the reference (re-read each pass, so a
// font/zoom change while open is picked up). Resolves to the placement used.
export const positionAnchoredOverlay = async (
  reference: VirtualElement,
  overlay: HTMLElement,
  gap: () => number,
  platform?: Platform
): Promise<Placement> => {
  // Measure at full height. Without this reset flip sees the height size
  // trimmed it to on the previous tick, decides it still fits, and the card
  // ratchets smaller as the page scrolls.
  overlay.style.maxHeight = `${viewportCap()}px`

  const { x, y, placement, middlewareData } = await computePosition(
    reference,
    overlay,
    {
      strategy: 'fixed',
      // 'top' keeps the overlay over already-read text, not the upcoming
      // sentence; flip moves it below the word when the full card doesn't fit
      // above; shift keeps it on screen sideways.
      placement: 'top',
      middleware: buildAnchoredOverlayMiddleware(overlay, gap),
      ...(platform ? { platform } : {}),
    }
  )
  overlay.style.left = `${x}px`
  overlay.style.top = `${y}px`
  applyReferenceHiddenVisibility(overlay, middlewareData.hide?.referenceHidden)
  return placement
}

// Selection translate button (ADR-007): same hide-when-clipped rule as the
// word card, placed by drag direction.
export const positionSelectionHint = async (
  reference: VirtualElement,
  overlay: HTMLElement,
  placement: Placement,
  platform?: Platform
): Promise<void> => {
  const { x, y, middlewareData } = await computePosition(reference, overlay, {
    strategy: 'fixed',
    placement,
    middleware: [
      offset(6),
      flip(),
      shift({ padding: OVERLAY_EDGE_PADDING }),
      hide({ padding: OVERLAY_EDGE_PADDING }),
    ],
    ...(platform ? { platform } : {}),
  })
  overlay.style.left = `${x}px`
  overlay.style.top = `${y}px`
  applyReferenceHiddenVisibility(overlay, middlewareData.hide?.referenceHidden)
}

// Gap between the sentence's last character and the hover button.
const HOVER_BUTTON_GAP = 2

// Hover sentence button (ADR-068, #1125): hang it off the bottom-right corner
// of the sentence's last character, so it never covers the sentence it
// translates. Covering the start of the next line is acceptable. With no room
// below it moves right of the character, and above only as a last resort.
export const positionHoverSentenceButton = async (
  lastCharacter: DOMRect,
  overlay: HTMLElement,
  platform?: Platform
): Promise<Placement> => {
  // The character itself is the reference, so `hide` sees a real glyph (a
  // zero-width line flush with the viewport edge counts as clipped). The
  // cross-axis offset moves 'bottom-start' / 'top-start' past the glyph, so
  // the button's left edge lines up with the character's right edge.
  const reference: VirtualElement = {
    getBoundingClientRect: () => lastCharacter,
    getClientRects: () => [lastCharacter],
  }
  const { x, y, placement, middlewareData } = await computePosition(reference, overlay, {
    strategy: 'fixed',
    placement: 'bottom-start',
    middleware: [
      offset(({ placement }) =>
        placement === 'right'
          ? HOVER_BUTTON_GAP
          : { mainAxis: HOVER_BUTTON_GAP, crossAxis: lastCharacter.width }
      ),
      // Main axis only: 'right' vertically centres the 28px button on a
      // ~20px glyph, so near the bottom it overflows on the cross axis by a
      // few px; shift below fixes that. With crossAxis on, flip would reject
      // 'right' and jump to 'top-start', over the sentence's previous line.
      flip({
        fallbackPlacements: ['right', 'top-start'],
        crossAxis: false,
        padding: OVERLAY_EDGE_PADDING,
      }),
      shift({ padding: OVERLAY_EDGE_PADDING }),
      // No padding: only a glyph fully off-screen hides the button; a final
      // period flush with the viewport edge would otherwise count as clipped.
      hide(),
    ],
    ...(platform ? { platform } : {}),
  })
  overlay.style.left = `${x}px`
  overlay.style.top = `${y}px`
  applyReferenceHiddenVisibility(overlay, middlewareData.hide?.referenceHidden)
  return placement
}
