import {
  DWELL_MS,
  GRACE_MS,
  createHoverSentenceRules,
  pointInSentenceRects,
  sameSentence,
  type SentenceIdentity,
} from '@/lib/hoverSentenceTranslate'

const sentence = (id: string): SentenceIdentity => ({
  startContainer: id,
  startOffset: 0,
  endContainer: id,
  endOffset: id.length,
})

const A = sentence('A')
const B = sentence('B')
const A2: SentenceIdentity = {
  startContainer: 'A',
  startOffset: 0,
  endContainer: 'A',
  endOffset: 99,
}

describe('sameSentence', () => {
  it('matches by start and end node and offset, not object identity', () => {
    expect(sameSentence(A, { ...A })).toBe(true)
    expect(sameSentence(A, A2)).toBe(false)
    expect(sameSentence(A, B)).toBe(false)
  })
})

describe('pointInSentenceRects', () => {
  it('treats the gap between adjacent wrapped line rects as inside', () => {
    const line1 = { left: 10, right: 200, top: 10, bottom: 24 }
    const line2 = { left: 10, right: 180, top: 30, bottom: 44 }
    expect(pointInSentenceRects([line1, line2], 50, 27)).toBe(true)
    expect(pointInSentenceRects([line1, line2], 5, 27)).toBe(false)
    expect(pointInSentenceRects([line1], 50, 15)).toBe(true)
  })
})

describe('createHoverSentenceRules', () => {
  it('shows the sentence after a 400 ms dwell and keeps it while moving within it', () => {
    const rules = createHoverSentenceRules()
    rules.pointerAt(A, 0)
    expect(rules.visible()).toBeNull()

    rules.tick(DWELL_MS - 1)
    expect(rules.visible()).toBeNull()

    rules.tick(DWELL_MS)
    expect(sameSentence(rules.visible()!, A)).toBe(true)

    rules.pointerAt(A, DWELL_MS + 50)
    expect(sameSentence(rules.visible()!, A)).toBe(true)
  })

  it('hides at the 700 ms grace deadline after leaving the sentence', () => {
    const rules = createHoverSentenceRules()
    rules.pointerAt(A, 0)
    rules.tick(DWELL_MS)
    rules.pointerAt(null, DWELL_MS)

    rules.tick(DWELL_MS + GRACE_MS - 1)
    expect(sameSentence(rules.visible()!, A)).toBe(true)

    rules.tick(DWELL_MS + GRACE_MS)
    expect(rules.visible()).toBeNull()
  })

  it('cancels grace when returning to the same sentence with a fresh Range identity', () => {
    const rules = createHoverSentenceRules()
    rules.pointerAt(A, 0)
    rules.tick(DWELL_MS)
    rules.pointerAt(null, DWELL_MS)

    const aAgain: SentenceIdentity = { ...A }
    rules.pointerAt(aAgain, DWELL_MS + 100)
    rules.tick(DWELL_MS + GRACE_MS + 100)
    expect(sameSentence(rules.visible()!, A)).toBe(true)
  })

  it('cancels grace when the pointer enters the button', () => {
    const rules = createHoverSentenceRules()
    rules.pointerAt(A, 0)
    rules.tick(DWELL_MS)
    rules.pointerAt(null, DWELL_MS)
    rules.enterButton(DWELL_MS + 50)

    rules.tick(DWELL_MS + GRACE_MS + 50)
    expect(sameSentence(rules.visible()!, A)).toBe(true)
  })

  it('starts a fresh grace after leaving the button for outside the sentence', () => {
    const rules = createHoverSentenceRules()
    rules.pointerAt(A, 0)
    rules.tick(DWELL_MS)
    rules.pointerAt(null, DWELL_MS)
    rules.enterButton(DWELL_MS + 50)
    rules.leaveButton(DWELL_MS + 100)

    rules.tick(DWELL_MS + 100 + GRACE_MS - 1)
    expect(sameSentence(rules.visible()!, A)).toBe(true)
    rules.tick(DWELL_MS + 100 + GRACE_MS)
    expect(rules.visible()).toBeNull()
  })

  it('keeps the old button until a second sentence finishes its dwell', () => {
    const rules = createHoverSentenceRules()
    rules.pointerAt(A, 0)
    rules.tick(DWELL_MS)
    expect(sameSentence(rules.visible()!, A)).toBe(true)

    rules.pointerAt(B, DWELL_MS + 10)
    rules.tick(DWELL_MS + 10 + DWELL_MS - 1)
    expect(sameSentence(rules.visible()!, A)).toBe(true)

    rules.tick(DWELL_MS + 10 + DWELL_MS)
    expect(sameSentence(rules.visible()!, B)).toBe(true)
  })

  it('respects the original grace when a second dwell begun late in grace is abandoned', () => {
    const rules = createHoverSentenceRules()
    rules.pointerAt(A, 0)
    rules.tick(DWELL_MS)
    const leftAt = DWELL_MS
    rules.pointerAt(null, leftAt)

    // Enter B late in A's grace; abandon before B's dwell completes.
    const enterB = leftAt + GRACE_MS - 100
    rules.pointerAt(B, enterB)
    rules.pointerAt(null, enterB + 50)

    rules.tick(leftAt + GRACE_MS - 1)
    expect(sameSentence(rules.visible()!, A)).toBe(true)
    rules.tick(leftAt + GRACE_MS)
    expect(rules.visible()).toBeNull()
  })

  it('suppresses hover while a mouse button is pressed or a selection exists', () => {
    const rules = createHoverSentenceRules()
    rules.pointerAt(A, 0)
    rules.setPressed(true, 10)
    rules.tick(DWELL_MS + 10)
    expect(rules.visible()).toBeNull()

    rules.setPressed(false, DWELL_MS + 20)
    rules.pointerAt(A, DWELL_MS + 20)
    rules.setSelectionNonEmpty(true, DWELL_MS + 30)
    rules.tick(DWELL_MS + 20 + DWELL_MS)
    expect(rules.visible()).toBeNull()
  })

  it('hides immediately on mousedown suppression and cancels timers', () => {
    const rules = createHoverSentenceRules()
    rules.pointerAt(A, 0)
    rules.tick(DWELL_MS)
    rules.setPressed(true, DWELL_MS + 5)
    expect(rules.visible()).toBeNull()
    rules.setPressed(false, DWELL_MS + 10)
    rules.tick(DWELL_MS + 10 + DWELL_MS - 1)
    expect(rules.visible()).toBeNull()
  })

  describe('dismissal (Escape and click)', () => {
    it('keeps a click-dismissed sentence hidden past 400 ms and after leaving the article and returning', () => {
      const rules = createHoverSentenceRules()
      rules.pointerAt(A, 0)
      rules.tick(DWELL_MS)
      rules.dismiss('click', DWELL_MS + 1)
      expect(rules.visible()).toBeNull()

      rules.pointerAt(A, DWELL_MS + 2)
      rules.tick(DWELL_MS + 2 + DWELL_MS)
      expect(rules.visible()).toBeNull()

      rules.pointerAt(null, DWELL_MS + 2 + DWELL_MS + 10)
      rules.pointerAt(A, DWELL_MS + 2 + DWELL_MS + 20)
      rules.tick(DWELL_MS + 2 + DWELL_MS + 20 + DWELL_MS)
      expect(rules.visible()).toBeNull()
    })

    it('starts a fresh dwell after Escape once the pointer enters a different sentence', () => {
      const rules = createHoverSentenceRules()
      rules.pointerAt(A, 0)
      rules.tick(DWELL_MS)
      rules.dismiss('escape', DWELL_MS + 1)

      rules.pointerAt(B, DWELL_MS + 2)
      rules.tick(DWELL_MS + 2 + DWELL_MS - 1)
      expect(rules.visible()).toBeNull()
      rules.tick(DWELL_MS + 2 + DWELL_MS)
      expect(sameSentence(rules.visible()!, B)).toBe(true)
    })

    it('Escape during a new sentence dwell dismisses the new sentence while the old button is still visible', () => {
      const rules = createHoverSentenceRules()
      rules.pointerAt(A, 0)
      rules.tick(DWELL_MS)
      rules.pointerAt(B, DWELL_MS + 10)
      rules.dismiss('escape', DWELL_MS + 20)
      expect(rules.visible()).toBeNull()

      // B is dismissed; staying on B must not show. Returning to A may show after dwell.
      rules.pointerAt(B, DWELL_MS + 30)
      rules.tick(DWELL_MS + 30 + DWELL_MS)
      expect(rules.visible()).toBeNull()

      rules.pointerAt(A, DWELL_MS + 30 + DWELL_MS + 10)
      rules.tick(DWELL_MS + 30 + DWELL_MS + 10 + DWELL_MS)
      expect(sameSentence(rules.visible()!, A)).toBe(true)
    })

    it('Escape during grace with the pointer outside dismisses the visible button sentence', () => {
      const rules = createHoverSentenceRules()
      rules.pointerAt(A, 0)
      rules.tick(DWELL_MS)
      rules.pointerAt(null, DWELL_MS + 10)
      rules.dismiss('escape', DWELL_MS + 20)
      expect(rules.visible()).toBeNull()

      rules.pointerAt(A, DWELL_MS + 30)
      rules.tick(DWELL_MS + 30 + DWELL_MS)
      expect(rules.visible()).toBeNull()
    })

    it('Escape during a pending dwell dismisses that target before it shows', () => {
      const rules = createHoverSentenceRules()
      rules.pointerAt(A, 0)
      rules.dismiss('escape', 100)
      rules.tick(DWELL_MS + 100)
      expect(rules.visible()).toBeNull()
      rules.pointerAt(A, DWELL_MS + 200)
      rules.tick(DWELL_MS + 200 + DWELL_MS)
      expect(rules.visible()).toBeNull()
    })
  })

  it('reset clears the visible button and pending work', () => {
    const rules = createHoverSentenceRules()
    rules.pointerAt(A, 0)
    rules.tick(DWELL_MS)
    rules.reset()
    expect(rules.visible()).toBeNull()
    rules.tick(DWELL_MS + GRACE_MS)
    expect(rules.visible()).toBeNull()
  })
})
