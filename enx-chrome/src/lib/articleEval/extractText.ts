// ADR-070: the text of an area, extracted the same way for the chosen nodes
// and for Readability's article: script, style and noscript subtrees are
// dropped, links and code are kept.

export function extractText(nodes: Element[]): string {
  return nodes
    .map(node => {
      const clone = node.cloneNode(true) as Element
      clone
        .querySelectorAll('script, style, noscript')
        .forEach(element => element.remove())
      return clone.textContent ?? ''
    })
    .join('\n')
}
