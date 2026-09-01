import { nearestElement, referenceLineHeight } from '@/lib/rangeUtils'

describe('nearestElement', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('returns the node itself when it is an element', () => {
    document.body.innerHTML = '<p id="p">hi</p>'
    const p = document.getElementById('p')!
    expect(nearestElement(p)).toBe(p)
  })

  it('returns the parent element when the node is a text node', () => {
    document.body.innerHTML = '<p id="p">hello world</p>'
    const p = document.getElementById('p')!
    expect(nearestElement(p.firstChild as Node)).toBe(p)
  })
})

describe('referenceLineHeight', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  // jsdom has no layout, so getClientRects() is empty -- these exercise the
  // fallback ladder, which is the part with real branching.

  it('falls back to the computed line-height of the range start element', () => {
    document.body.innerHTML = '<p id="p" style="line-height: 30px">hello world</p>'
    const p = document.getElementById('p')!
    const range = document.createRange()
    range.selectNodeContents(p)
    expect(referenceLineHeight(range)).toBe(30)
  })

  it('falls back to font-size * 1.2 when line-height is not a number', () => {
    document.body.innerHTML =
      '<p id="p" style="line-height: normal; font-size: 20px">hello world</p>'
    const p = document.getElementById('p')!
    const range = document.createRange()
    range.setStart(p.firstChild as Node, 0)
    range.collapse(true)
    expect(referenceLineHeight(range)).toBe(24)
  })

  it('returns a fixed default when nothing else resolves', () => {
    // A detached text node: no parent element, no computed style.
    const orphan = document.createTextNode('orphan text node')
    const range = document.createRange()
    range.setStart(orphan, 0)
    range.collapse(true)
    expect(referenceLineHeight(range)).toBe(20)
  })
})
