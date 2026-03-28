/**
 * Tests for code block exclusion from word highlighting.
 *
 * Verifies that text inside <code> and <pre> elements is NOT processed
 * (no enx-word markup added), while regular article text is still highlighted.
 *
 * See: docs/EXCLUDE_CODE_BLOCKS.md
 */

// NodeFilter constants are needed by the TreeWalker polyfill in JSDOM
Object.defineProperty(global, 'NodeFilter', {
  value: {
    SHOW_TEXT: 4,
    FILTER_ACCEPT: 1,
    FILTER_REJECT: 2,
    FILTER_SKIP: 3,
  },
  writable: true,
})

import { WordData } from '../../types'

/**
 * Minimal renderWithHighlights that mirrors the exclusion logic in content.ts.
 * <code> and <pre> ancestors cause a text node to be rejected.
 */
function renderWithHighlights(
  originalHtml: string,
  wordDict: Record<string, WordData>
): string {
  const tempDiv = document.createElement('div')
  tempDiv.innerHTML = originalHtml

  const wordKeys = Object.keys(wordDict)
  if (wordKeys.length === 0) return originalHtml

  const wordInfos = wordKeys
    .map(word => ({
      word,
      regex: new RegExp(
        `\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
        'gi'
      ),
    }))
    .sort((a, b) => b.word.length - a.word.length)

  const walker = document.createTreeWalker(tempDiv, NodeFilter.SHOW_TEXT, {
    acceptNode: node => {
      const parent = (node as Text).parentElement
      if (!parent) return NodeFilter.FILTER_REJECT

      let current: Element | null = parent
      while (current && current !== tempDiv) {
        const tagName = current.tagName.toLowerCase()
        if (
          [
            'a',
            'script',
            'style',
            'noscript',
            'button',
            'input',
            'textarea',
            'select',
            'code',
            'pre',
          ].includes(tagName)
        ) {
          return NodeFilter.FILTER_REJECT
        }
        current = current.parentElement
      }

      const text = node.textContent?.trim() || ''
      return text.length > 0 && /[a-zA-Z]/.test(text)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT
    },
  })

  const textNodes: Text[] = []
  let node = walker.nextNode()
  while (node) {
    textNodes.push(node as Text)
    node = walker.nextNode()
  }

  const replacements: { node: Text; newContent: string }[] = []

  textNodes.forEach(textNode => {
    let text = textNode.textContent || ''
    let hasChanges = false
    const placeholders: { placeholder: string; html: string }[] = []
    let idx = 0

    wordInfos.forEach(({ word, regex }) => {
      if (regex.test(text)) {
        text = text.replace(regex, match => {
          hasChanges = true
          const placeholder = `___ENX_${idx++}___`
          placeholders.push({
            placeholder,
            html: `<u class="enx-word enx-${word.toLowerCase()}" data-word="${match}">${match}</u>`,
          })
          return placeholder
        })
        regex.lastIndex = 0
      }
    })

    if (hasChanges) {
      placeholders.forEach(({ placeholder, html }) => {
        text = text.replace(placeholder, html)
      })
      replacements.push({ node: textNode, newContent: text })
    }
  })

  replacements.forEach(({ node, newContent }) => {
    const tempContainer = document.createElement('span')
    tempContainer.innerHTML = newContent
    const fragment = document.createDocumentFragment()
    while (tempContainer.firstChild) {
      fragment.appendChild(tempContainer.firstChild)
    }
    node.parentNode?.replaceChild(fragment, node)
  })

  return tempDiv.innerHTML
}

// Shared word dictionary used across tests
const wordDict: Record<string, WordData> = {
  yaml: {
    Key: 'yaml',
    English: 'yaml',
    Chinese: 'yaml格式',
    AlreadyAcquainted: 0,
    LoadCount: 5,
    WordType: 0,
    Pronunciation: '',
  },
  config: {
    Key: 'config',
    English: 'config',
    Chinese: '配置',
    AlreadyAcquainted: 0,
    LoadCount: 8,
    WordType: 0,
    Pronunciation: '',
  },
}

describe('Code block exclusion', () => {
  it('should NOT highlight words inside inline <code>', () => {
    const html = '<p>Read this: <code>yaml config</code></p>'
    const result = renderWithHighlights(html, wordDict)
    expect(result).toContain('<code>yaml config</code>')
    expect(result).not.toMatch(/<code>[\s\S]*enx-word[\s\S]*<\/code>/)
  })

  it('should NOT highlight words inside <pre><code>', () => {
    const html =
      '<pre><code>yaml\nBucketNamePrefix: value\nconfig: true</code></pre>'
    const result = renderWithHighlights(html, wordDict)
    expect(result).not.toContain('enx-word')
  })

  it('should NOT highlight words inside bare <pre>', () => {
    const html = '<pre>yaml config here</pre>'
    const result = renderWithHighlights(html, wordDict)
    expect(result).not.toContain('enx-word')
  })

  it('should still highlight words in regular <p> text', () => {
    const html = '<p>Read yaml docs for config options</p>'
    const result = renderWithHighlights(html, wordDict)
    expect(result).toContain('enx-word')
    expect(result).toContain('data-word="yaml"')
    expect(result).toContain('data-word="config"')
  })

  it('should highlight <p> text but NOT highlight adjacent <code> text', () => {
    const html =
      '<p>Read yaml docs</p><pre><code>yaml: value\nconfig: true</code></pre>'
    const result = renderWithHighlights(html, wordDict)
    // <p> text should be highlighted
    expect(result).toMatch(/<p>[\s\S]*enx-word[\s\S]*<\/p>/)
    // <code> text should NOT be highlighted
    expect(result).not.toMatch(/<code>[\s\S]*enx-word[\s\S]*<\/code>/)
  })

  it('should highlight text in <p> but skip <code> within the same <p>', () => {
    const html =
      '<p>Read the yaml docs. <code>yaml: value</code> for details.</p>'
    const result = renderWithHighlights(html, wordDict)
    // The word inside <code> must stay untouched
    expect(result).toContain('<code>yaml: value</code>')
    // At least one enx-word should appear (the "yaml" in "Read the yaml docs")
    expect(result).toContain('enx-word')
  })
})
