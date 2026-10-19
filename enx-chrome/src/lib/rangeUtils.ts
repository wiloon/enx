// Small DOM/Range helpers shared between the content script (popup
// positioning) and WordProcessor (sentence-container lookup). Kept here so
// the logic is importable and unit-testable -- content.tsx itself can't be
// imported into Jest (Vite-only `?inline` CSS import).

// The nearest Element for a node: the node itself if it is one, otherwise its
// parent element. Returns null only for a detached text node / the document.
export const nearestElement = (node: Node): Element | null =>
  node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement

// Line pitch at the range's start, used as the popup's vertical offset so
// its bottom edge clears the whole line above the clicked word (ADR-005).
// The range's rect is only the glyph box (~font-size * 1.15), so on a page
// with loose line spacing it alone lets the card cut into that line; take
// the larger of it and the computed line-height (font-size * 1.2 when
// `normal`), with a fixed default when neither resolves.
export const referenceLineHeight = (range: Range): number => {
  // getClientRects isn't implemented on jsdom's Range; guard so this stays
  // callable there.
  const rectHeight =
    typeof range.getClientRects === 'function'
      ? (range.getClientRects()[0]?.height ?? 0)
      : 0

  let styleHeight = 0
  const el = nearestElement(range.startContainer)
  if (el) {
    const style = window.getComputedStyle(el)
    const lineHeight = parseFloat(style.lineHeight)
    const fontSize = parseFloat(style.fontSize)
    if (!Number.isNaN(lineHeight)) styleHeight = lineHeight
    else if (!Number.isNaN(fontSize)) styleHeight = fontSize * 1.2
  }

  const height = Math.max(rectHeight, styleHeight)
  return height > 0 ? Math.ceil(height) : 20
}
