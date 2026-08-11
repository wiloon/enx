/**
 * Tests for the phrase-selection anchor lookup used by the ADR-008
 * phrase-in-context lookup (2-5 word drag-selections inside a larger
 * sentence). Mirrors `findPhraseAnchor` from `content.tsx` -- that file
 * can't be imported directly in Jest (it pulls in a Vite-only
 * `?inline` CSS import), so the logic is reimplemented here, same as
 * `flexContainerFix.test.ts`/`codeBlockExclusion.test.ts` do for their
 * own pieces of content.tsx.
 *
 * @jest-environment jsdom
 */

// Mirrors content.tsx's findPhraseAnchor (ADR-008 Decision §1): prefers
// event.target when it's itself an already-wrapped word, otherwise scans
// the selection's Range for any .enx-word element it intersects.
function findPhraseAnchor(event: { target: EventTarget | null }): HTMLElement | null {
  const target = event.target as HTMLElement
  if (target?.classList?.contains('enx-word')) return target

  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)

  let container = range.commonAncestorContainer as Node
  if (container.nodeType !== Node.ELEMENT_NODE) {
    container = container.parentElement as Node
  }
  if (!container || !(container instanceof HTMLElement)) return null

  const candidates = container.querySelectorAll('.enx-word')
  for (const candidate of Array.from(candidates)) {
    if (range.intersectsNode(candidate)) {
      return candidate as HTMLElement
    }
  }
  return null
}

describe('findPhraseAnchor (ADR-008)', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    window.getSelection()?.removeAllRanges()
  })

  it('returns event.target directly when it is itself an .enx-word element', () => {
    document.body.innerHTML =
      '<p>find the right contacts, <u class="enx-word">hunt</u> <u class="enx-word">down</u> <u class="enx-word">emails</u>, and draft outreach.</p>'
    const huntEl = document.querySelector('.enx-word') as HTMLElement

    const anchor = findPhraseAnchor({ target: huntEl })
    expect(anchor).toBe(huntEl)
  })

  it('falls back to scanning the selection range when mouseup lands on non-word text (e.g. the comma)', () => {
    document.body.innerHTML =
      '<p id="para">find the right contacts, <u class="enx-word">hunt</u> <u class="enx-word">down</u> <u class="enx-word">emails</u>, and draft outreach.</p>'
    const para = document.getElementById('para') as HTMLElement
    const huntEl = document.querySelector('.enx-word') as HTMLElement
    const emailsEl = document.querySelectorAll('.enx-word')[2] as HTMLElement

    const range = document.createRange()
    range.setStart(huntEl.firstChild as Node, 0)
    range.setEnd(emailsEl.firstChild as Node, (emailsEl.textContent || '').length)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    // mouseup's event.target lands on the paragraph itself, not on any one
    // <u class="enx-word"> span (e.g. it released over the trailing comma).
    const anchor = findPhraseAnchor({ target: para })
    expect(anchor).not.toBeNull()
    expect(anchor?.classList.contains('enx-word')).toBe(true)
  })

  it('returns null when the selection has no .enx-word element at all (e.g. entirely inside an excluded <a>)', () => {
    document.body.innerHTML =
      '<p id="para">See <a id="link" href="#">the linked phrase here</a> for details.</p>'
    const link = document.getElementById('link') as HTMLElement

    const range = document.createRange()
    range.selectNodeContents(link)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    const anchor = findPhraseAnchor({ target: link })
    expect(anchor).toBeNull()
  })

  it('returns null when there is no active selection', () => {
    document.body.innerHTML = '<p id="para">plain text, no selection</p>'
    const para = document.getElementById('para') as HTMLElement
    window.getSelection()?.removeAllRanges()

    const anchor = findPhraseAnchor({ target: para })
    expect(anchor).toBeNull()
  })
})
