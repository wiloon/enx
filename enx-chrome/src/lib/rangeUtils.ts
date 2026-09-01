// Small DOM/Range helpers shared between the content script (popup
// positioning) and WordProcessor (sentence-container lookup). Kept here so
// the logic is importable and unit-testable -- content.tsx itself can't be
// imported into Jest (Vite-only `?inline` CSS import).

// The nearest Element for a node: the node itself if it is one, otherwise its
// parent element. Returns null only for a detached text node / the document.
export const nearestElement = (node: Node): Element | null =>
  node.nodeType === Node.ELEMENT_NODE
    ? (node as Element)
    : node.parentElement

// Height of one line of text at the range's start, used as the popup's
// vertical offset so its edge clears the line the clicked word sits on
// (ADR-005). Prefer the range's own line-box height; fall back to the
// computed line-height, then font-size * 1.2, then a fixed default.
export const referenceLineHeight = (range: Range): number => {
  // getClientRects isn't implemented on jsdom's Range (tests exercise the
  // fallback ladder below); guard so this stays callable there.
  const rectHeight =
    typeof range.getClientRects === 'function'
      ? range.getClientRects()[0]?.height
      : undefined
  if (rectHeight && rectHeight > 0) return Math.ceil(rectHeight)

  const el = nearestElement(range.startContainer)
  if (el) {
    const style = window.getComputedStyle(el)
    const lineHeight = parseFloat(style.lineHeight)
    if (!Number.isNaN(lineHeight)) return Math.ceil(lineHeight)
    const fontSize = parseFloat(style.fontSize)
    if (!Number.isNaN(fontSize)) return Math.ceil(fontSize * 1.2)
  }
  return 20
}
