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

// Drag-select hint button: same hide-when-clipped rule as the word card, with
// a fixed gap and a caller-chosen placement (forward = bottom-end, backward =
// top-start).
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
