import { platform, type Platform, type Rect } from '@floating-ui/dom'
import {
  OVERLAY_EDGE_PADDING,
  applyReferenceHiddenVisibility,
  buildAnchoredOverlayMiddleware,
  positionAnchoredOverlay,
  positionHoverSentenceButton,
  positionSelectionHint,
} from '../overlayPositioning'

// jsdom has no layout, so the platform is faked: the viewport is
// window.innerWidth x innerHeight, and the overlay is `naturalHeight` tall
// unless its max-height says less -- the one bit of layout the bug hinged on.
const fakePlatform = (naturalHeight: number, width = 400): Platform => {
  const dims = (el: Element) => {
    const max = parseFloat((el as HTMLElement).style.maxHeight)
    return {
      width,
      height: Number.isNaN(max) ? naturalHeight : Math.min(naturalHeight, max),
    }
  }
  return {
    ...platform,
    getElementRects: async ({ reference, floating }) => ({
      reference: reference.getBoundingClientRect() as Rect,
      floating: { x: 0, y: 0, ...dims(floating) },
    }),
    getDimensions: async el => dims(el),
    getClippingRect: async () => ({
      x: 0,
      y: 0,
      width: window.innerWidth,
      height: window.innerHeight,
    }),
  }
}

const wordAt = (top: number) => {
  const rect = { x: 500, y: top, top, left: 500, width: 80, height: 20 }
  const full = { ...rect, right: 580, bottom: top + 20 }
  return {
    getBoundingClientRect: () => full,
    getClientRects: () => [full],
  }
}

const GAP = 20
const HEIGHT = 200

describe('positionAnchoredOverlay', () => {
  let overlay: HTMLElement
  beforeEach(() => {
    overlay = document.createElement('div')
    document.body.appendChild(overlay)
  })
  afterEach(() => overlay.remove())

  it('sits above the word at full height when there is room', async () => {
    const placement = await positionAnchoredOverlay(
      wordAt(400),
      overlay,
      () => GAP,
      fakePlatform(HEIGHT)
    )
    expect(placement).toBe('top')
    expect(parseFloat(overlay.style.maxHeight)).toBeGreaterThanOrEqual(HEIGHT)
  })

  // The reported bug: room above was a few px short of card + edge padding,
  // so the card stayed on top, got trimmed, and the trimmed card kept
  // "fitting" as the page scrolled -- a half card with a scrollbar.
  it('flips below the word instead of shrinking when the top is a few px short', async () => {
    const top = GAP + HEIGHT + OVERLAY_EDGE_PADDING - 3
    const fake = fakePlatform(HEIGHT)
    for (let tick = 0; tick < 3; tick++) {
      const placement = await positionAnchoredOverlay(
        wordAt(top),
        overlay,
        () => GAP,
        fake
      )
      expect(placement).toBe('bottom')
      expect(parseFloat(overlay.style.maxHeight)).toBeGreaterThanOrEqual(HEIGHT)
    }
  })

  it('grows back to full height after a tick where it had to shrink', async () => {
    const fake = fakePlatform(HEIGHT)
    overlay.style.maxHeight = '120px' // left over from a cramped tick
    await positionAnchoredOverlay(wordAt(400), overlay, () => GAP, fake)
    expect(parseFloat(overlay.style.maxHeight)).toBeGreaterThanOrEqual(HEIGHT)
  })

  it('shrinks only when neither side has room', async () => {
    const tall = window.innerHeight // never fits above or below
    const placement = await positionAnchoredOverlay(
      wordAt(window.innerHeight / 2),
      overlay,
      () => GAP,
      fakePlatform(tall)
    )
    expect(['top', 'bottom']).toContain(placement)
    expect(parseFloat(overlay.style.maxHeight)).toBeLessThan(tall)
  })

  // #523: once the word is fully clipped, hide the card in place rather than
  // letting flip/shift park it near the pointer.
  it('includes hide in the middleware list', () => {
    const names = buildAnchoredOverlayMiddleware(overlay, () => GAP).map(
      m => m.name
    )
    expect(names).toContain('hide')
  })

  it('hides the overlay when the reference is clipped', async () => {
    await positionAnchoredOverlay(
      wordAt(-100),
      overlay,
      () => GAP,
      fakePlatform(HEIGHT)
    )
    expect(overlay.style.visibility).toBe('hidden')
  })

  it('clears the hidden style when the reference is on-screen', async () => {
    overlay.style.visibility = 'hidden'
    await positionAnchoredOverlay(
      wordAt(400),
      overlay,
      () => GAP,
      fakePlatform(HEIGHT)
    )
    expect(overlay.style.visibility).toBe('visible')
  })
})

describe('applyReferenceHiddenVisibility', () => {
  let overlay: HTMLElement
  beforeEach(() => {
    overlay = document.createElement('div')
  })

  it('sets visibility hidden when referenceHidden is true', () => {
    applyReferenceHiddenVisibility(overlay, true)
    expect(overlay.style.visibility).toBe('hidden')
  })

  it('sets visibility visible when referenceHidden is false', () => {
    overlay.style.visibility = 'hidden'
    applyReferenceHiddenVisibility(overlay, false)
    expect(overlay.style.visibility).toBe('visible')
  })
})

describe('positionSelectionHint', () => {
  let overlay: HTMLElement
  beforeEach(() => {
    overlay = document.createElement('div')
    document.body.appendChild(overlay)
  })
  afterEach(() => overlay.remove())

  it('hides the hint when its anchor rect is clipped', async () => {
    await positionSelectionHint(
      wordAt(-100),
      overlay,
      'bottom-end',
      fakePlatform(28)
    )
    expect(overlay.style.visibility).toBe('hidden')
  })

  it('shows the hint when its anchor rect is on-screen', async () => {
    overlay.style.visibility = 'hidden'
    await positionSelectionHint(
      wordAt(400),
      overlay,
      'bottom-end',
      fakePlatform(28)
    )
    expect(overlay.style.visibility).toBe('visible')
  })
})

// #1125: the hover button must never sit on the sentence it translates. It
// hangs off the bottom-right corner of the sentence's last character.
describe('positionHoverSentenceButton', () => {
  const BUTTON = 28
  let overlay: HTMLElement
  beforeEach(() => {
    overlay = document.createElement('div')
    document.body.appendChild(overlay)
  })
  afterEach(() => overlay.remove())

  // A glyph (10x20 unless narrower) whose top-left is (left, top).
  const charAt = (left: number, top: number, width = 10) =>
    new DOMRect(left, top, width, 20)
  const box = () => ({
    left: parseFloat(overlay.style.left),
    top: parseFloat(overlay.style.top),
  })

  it('puts its top-left corner at the last character\'s bottom-right', async () => {
    await positionHoverSentenceButton(
      charAt(500, 400),
      overlay,
      fakePlatform(BUTTON, BUTTON)
    )
    const { left, top } = box()
    expect(left).toBeGreaterThanOrEqual(510)
    expect(left).toBeLessThanOrEqual(514)
    expect(top).toBeGreaterThanOrEqual(420)
    expect(top).toBeLessThanOrEqual(424)
  })

  it('stays below the character when shifted in from the right edge', async () => {
    await positionHoverSentenceButton(
      charAt(window.innerWidth - 12, 400),
      overlay,
      fakePlatform(BUTTON, BUTTON)
    )
    const { left, top } = box()
    expect(left + BUTTON).toBeLessThanOrEqual(window.innerWidth)
    expect(top).toBeGreaterThanOrEqual(420)
  })

  it('stays visible when a final period is flush with the right edge', async () => {
    await positionHoverSentenceButton(
      charAt(window.innerWidth - 4, 400, 4),
      overlay,
      fakePlatform(BUTTON, BUTTON)
    )
    expect(overlay.style.visibility).toBe('visible')
    const { left, top } = box()
    expect(left + BUTTON).toBeLessThanOrEqual(window.innerWidth)
    expect(top).toBeGreaterThanOrEqual(420)
  })

  it('moves right of the character when there is no room below', async () => {
    const char = charAt(500, window.innerHeight - 24)
    const placement = await positionHoverSentenceButton(
      char,
      overlay,
      fakePlatform(BUTTON, BUTTON)
    )
    expect(placement).toBe('right')
    const { left, top } = box()
    expect(left).toBeGreaterThanOrEqual(char.right)
    // Beside the glyph, not lifted above it onto the line before.
    expect(top + BUTTON).toBeGreaterThan(char.top)
    expect(top).toBeLessThan(char.bottom)
    expect(top + BUTTON).toBeLessThanOrEqual(window.innerHeight)
  })

  it('goes above the character only in the bottom-right corner', async () => {
    const char = charAt(window.innerWidth - 40, window.innerHeight - 24)
    const placement = await positionHoverSentenceButton(
      char,
      overlay,
      fakePlatform(BUTTON, BUTTON)
    )
    expect(placement).toBe('top-start')
    expect(box().top + BUTTON).toBeLessThanOrEqual(char.top)
  })

  it('hides when the last character is scrolled off-screen', async () => {
    await positionHoverSentenceButton(
      charAt(500, -100),
      overlay,
      fakePlatform(BUTTON, BUTTON)
    )
    expect(overlay.style.visibility).toBe('hidden')
  })
})
