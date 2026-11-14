// The article text reading anchors are measured against (ADR-081 Decision 1):
// the text nodes of every lookup-area root in document order, each
// whitespace run one space, trimmed, roots separated by a space. Normalizing
// the same way as normalizeWhitespace lets an anchor's sentence be matched
// in it character for character.

const NOT_TEXT = 'script, style, noscript, template'
const WHITESPACE = /\s/

export interface ArticleText {
  text: string
  /**
   * The article offset of the first character of text at or after a DOM
   * position, or null when the position is outside the article.
   */
  offsetOf(container: Node, offset: number): number | null
}

interface NodeStart {
  node: Text
  /** Article length before this node, and whether a space was pending. */
  length: number
  pendingSpace: boolean
}

export function readArticleText(roots: readonly Node[]): ArticleText {
  const starts: NodeStart[] = []
  let text = ''
  let pendingSpace = false

  for (const root of roots) {
    pendingSpace = true
    const doc = root.ownerDocument ?? (root as Document)
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement?.closest(NOT_TEXT)) continue
      const data = (node as Text).data
      starts.push({ node: node as Text, length: text.length, pendingSpace })
      const words = data.replace(/\s+/g, ' ').trim()
      if (words === '') {
        pendingSpace ||= data !== ''
        continue
      }
      if ((pendingSpace || WHITESPACE.test(data[0])) && text !== '') {
        text += ' '
      }
      text += words
      pendingSpace = WHITESPACE.test(data[data.length - 1])
    }
  }

  // The article offset of a character that is not whitespace.
  const offsetOfChar = (start: NodeStart, index: number) => {
    let { length, pendingSpace } = start
    const data = start.node.data
    for (let i = 0; i < index; i++) {
      if (WHITESPACE.test(data[i])) {
        pendingSpace = true
        continue
      }
      if (pendingSpace && length > 0) length++
      pendingSpace = false
      length++
    }
    return pendingSpace && length > 0 ? length + 1 : length
  }

  const offsetFrom = (first: number, offset: number) => {
    for (let k = first; k < starts.length; k++) {
      const data = starts[k].node.data
      let i = k === first ? offset : 0
      while (i < data.length && WHITESPACE.test(data[i])) i++
      if (i < data.length) return offsetOfChar(starts[k], i)
    }
    return text.length
  }

  return {
    text,
    offsetOf(container, offset) {
      if (container.nodeType === Node.TEXT_NODE) {
        const index = starts.findIndex(s => s.node === container)
        return index < 0 ? null : offsetFrom(index, offset)
      }
      if (!roots.some(root => root === container || root.contains(container))) {
        return null
      }
      const doc = container.ownerDocument ?? (container as Document)
      const point = doc.createRange()
      point.setStart(container, offset)
      const next = starts.findIndex(s => point.comparePoint(s.node, 0) >= 0)
      return next < 0 ? text.length : offsetFrom(next, 0)
    },
  }
}
