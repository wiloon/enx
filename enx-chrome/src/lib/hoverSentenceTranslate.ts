// Hover sentence-translate button rules (ADR-068): when to show, move and
// hide the button. Geometry, sentence identity and the clock are inputs so
// content.tsx can wire DOM events and tests can drive a fake clock.

export const DWELL_MS = 400
export const GRACE_MS = 700

// Opaque node handles: content.tsx passes real Nodes; tests pass strings.
export type SentenceIdentity = {
  startContainer: unknown
  startOffset: number
  endContainer: unknown
  endOffset: number
}

export const sameSentence = (
  a: SentenceIdentity,
  b: SentenceIdentity
): boolean =>
  a.startContainer === b.startContainer &&
  a.startOffset === b.startOffset &&
  a.endContainer === b.endContainer &&
  a.endOffset === b.endOffset

export type RectLike = {
  left: number
  right: number
  top: number
  bottom: number
}

// True when (x, y) hits a line rect or the gap between two adjacent wrapped
// lines (ADR-068: move across wrap gaps without leaving the sentence).
export const pointInSentenceRects = (
  rects: readonly RectLike[],
  x: number,
  y: number
): boolean => {
  for (const r of rects) {
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true
  }
  if (rects.length < 2) return false
  const lines: RectLike[] = []
  for (const rect of [...rects].sort((a, b) => a.top - b.top)) {
    const line = lines[lines.length - 1]
    if (line && rect.top <= line.bottom) {
      line.left = Math.min(line.left, rect.left)
      line.right = Math.max(line.right, rect.right)
      line.bottom = Math.max(line.bottom, rect.bottom)
    } else {
      lines.push({
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      })
    }
  }
  for (let i = 0; i < lines.length - 1; i++) {
    const a = lines[i]
    const b = lines[i + 1]
    const left = Math.min(a.left, b.left)
    const right = Math.max(a.right, b.right)
    if (x >= left && x <= right && y > a.bottom && y < b.top) return true
  }
  return false
}

export type HoverSentenceRules = {
  visible: () => SentenceIdentity | null
  isSuppressed: () => boolean
  nextDeadline: () => number | null
  pointerAt: (target: SentenceIdentity | null, now: number) => void
  enterButton: (now: number) => void
  leaveButton: (now: number) => void
  setPressed: (pressed: boolean, now: number) => void
  setSelectionNonEmpty: (nonEmpty: boolean, now: number) => void
  dismiss: (kind: 'escape' | 'click', now: number) => void
  tick: (now: number) => void
  reset: () => void
}

type Dwell = { sentence: SentenceIdentity; readyAt: number }

export const createHoverSentenceRules = (): HoverSentenceRules => {
  let visible: SentenceIdentity | null = null
  let dwell: Dwell | null = null
  let graceUntil: number | null = null
  let pointer: SentenceIdentity | null = null
  let overButton = false
  let pressed = false
  let selectionNonEmpty = false
  let dismissed: SentenceIdentity | null = null

  const suppressed = () => pressed || selectionNonEmpty

  const clearTimers = () => {
    dwell = null
    graceUntil = null
  }

  const hide = () => {
    visible = null
    clearTimers()
  }

  const isDismissed = (s: SentenceIdentity) =>
    dismissed !== null && sameSentence(dismissed, s)

  const startDwell = (s: SentenceIdentity, now: number) => {
    if (isDismissed(s)) {
      dwell = null
      return
    }
    if (dwell && sameSentence(dwell.sentence, s)) return
    dwell = { sentence: s, readyAt: now + DWELL_MS }
  }

  const startGrace = (now: number) => {
    if (overButton) {
      graceUntil = null
      return
    }
    graceUntil = now + GRACE_MS
  }

  const applyVisibleReady = (now: number) => {
    if (!dwell || now < dwell.readyAt) return
    if (isDismissed(dwell.sentence)) {
      dwell = null
      return
    }
    visible = dwell.sentence
    dwell = null
    graceUntil = null
    if (dismissed && !sameSentence(dismissed, visible)) {
      // Left the dismissed sentence for a different one that is now showing.
      dismissed = null
    }
  }

  const applyGraceExpiry = (now: number) => {
    if (dwell || graceUntil === null || now < graceUntil) return
    if (overButton) {
      graceUntil = null
      return
    }
    if (pointer && visible && sameSentence(pointer, visible)) {
      graceUntil = null
      return
    }
    hide()
  }

  const tick = (now: number) => {
    if (suppressed()) return
    applyVisibleReady(now)
    applyGraceExpiry(now)
  }

  const pointerAt = (target: SentenceIdentity | null, now: number) => {
    pointer = target
    if (suppressed()) {
      clearTimers()
      return
    }

    if (target && isDismissed(target)) {
      // Stay on a dismissed sentence: no dwell, keep hidden if that was it.
      if (dwell && sameSentence(dwell.sentence, target)) dwell = null
      if (visible && sameSentence(visible, target)) {
        hide()
      }
      // If another sentence is still showing (grace/switch), leave it alone
      // unless we already cleared it; do not start a new dwell on dismissed.
      if (!visible) {
        dwell = null
        graceUntil = null
      }
      return
    }

    if (target === null) {
      dwell = null
      if (visible && !overButton && graceUntil === null) startGrace(now)
      tick(now)
      return
    }

    // Clear dismissal when entering a different eligible sentence.
    if (dismissed && !sameSentence(dismissed, target)) {
      dismissed = null
    }

    if (visible && sameSentence(visible, target)) {
      dwell = null
      graceUntil = null
      tick(now)
      return
    }

    if (visible) {
      // Switching: keep old button; preserve existing grace deadline if any,
      // otherwise start grace from this leave so abandoned dwell still expires.
      if (graceUntil === null) startGrace(now)
      startDwell(target, now)
      tick(now)
      return
    }

    startDwell(target, now)
    tick(now)
  }

  const enterButton = (now: number) => {
    overButton = true
    graceUntil = null
    tick(now)
  }

  const leaveButton = (now: number) => {
    overButton = false
    if (suppressed()) return
    // Fresh grace when leaving the button for space outside the sentence.
    if (visible && (!pointer || !sameSentence(pointer, visible))) {
      startGrace(now)
    }
    tick(now)
  }

  const setPressed = (next: boolean, now: number) => {
    pressed = next
    if (next) {
      hide()
      overButton = false
    }
    tick(now)
  }

  const setSelectionNonEmpty = (nonEmpty: boolean, now: number) => {
    selectionNonEmpty = nonEmpty
    if (nonEmpty) {
      hide()
      overButton = false
    }
    tick(now)
  }

  const dismiss = (kind: 'escape' | 'click', _now: number) => {
    if (suppressed()) return
    if (kind === 'click') {
      if (visible) dismissed = visible
    } else {
      // Escape: pointer target (including dwell), else the visible button.
      if (pointer) dismissed = pointer
      else if (dwell) dismissed = dwell.sentence
      else if (visible) dismissed = visible
    }
    hide()
    overButton = false
  }

  const reset = () => {
    hide()
    overButton = false
    pointer = null
    pressed = false
    selectionNonEmpty = false
    dismissed = null
  }

  return {
    visible: () => visible,
    isSuppressed: suppressed,
    // A switch holds the old sentence until the new dwell finishes. Keep the
    // original grace deadline so abandoning the dwell can still expire it.
    nextDeadline: () => dwell?.readyAt ?? graceUntil,
    pointerAt,
    enterButton,
    leaveButton,
    setPressed,
    setSelectionNonEmpty,
    dismiss,
    tick,
    reset,
  }
}
