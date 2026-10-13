// Floating UI placement for the anchored overlay (the dictionary-lookup card
// and the drag-select hint). Kept out of content.tsx so it can be unit-tested
// against a fake platform -- jsdom has no layout.
import {
  computePosition,
  offset,
  flip,
  shift,
  size,
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

  const { x, y, placement } = await computePosition(reference, overlay, {
    strategy: 'fixed',
    // 'top' keeps the overlay over already-read text, not the upcoming
    // sentence; flip moves it below the word when the full card doesn't fit
    // above; shift keeps it on screen sideways.
    placement: 'top',
    middleware: [
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
    ],
    ...(platform ? { platform } : {}),
  })
  overlay.style.left = `${x}px`
  overlay.style.top = `${y}px`
  return placement
}
