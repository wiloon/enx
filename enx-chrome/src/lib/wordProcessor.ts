import { WordData } from '@/types'

// Single source of truth for article extraction / word highlighting.
// content.ts and its tests import this instead of keeping their own copies.
export class WordProcessor {
  static readonly WORD_PATTERNS = {
    contractedWord: /\b[a-zA-Z][a-zA-Z'''-]*[a-zA-Z]\b|\b[a-zA-Z]\b/g,
    htmlTag: /<[^>]*>/g,
    htmlEntity: /&[a-zA-Z0-9#]+;/g,
  }

  static extractWords(text: string): string[] {
    if (!text || text.trim() === '') return []

    const cleanText = text
      .replace(this.WORD_PATTERNS.htmlTag, ' ')
      .replace(this.WORD_PATTERNS.htmlEntity, ' ')

    const words = cleanText.match(this.WORD_PATTERNS.contractedWord) || []

    return words
      .map(word => word.trim())
      .filter(word => {
        return (
          word.length > 0 &&
          word.length <= 50 &&
          !/^\d+$/.test(word) &&
          /[a-zA-Z]/.test(word)
        )
      })
      .map(word => word.toLowerCase())
  }

  static getColorCode(wordData: WordData): string {
    // If word is already acquainted, known word type, or not in database, don't highlight
    if (
      wordData.AlreadyAcquainted === 1 ||
      wordData.WordType === 1 ||
      wordData.LoadCount === 0
    ) {
      return '#FFFFFF'
    }

    const loadCount = wordData.LoadCount || 0
    const normalizedCount = Math.min(loadCount, 30) / 30
    const hue = Math.round(300 * normalizedCount)

    return `hsl(${hue}, 100%, 40%)`
  }

  static renderWithHighlights(
    originalHtml: string,
    wordDict: Record<string, WordData>
  ): string {
    const wordKeys = Object.keys(wordDict)
    if (wordKeys.length === 0) {
      return originalHtml
    }

    const tempDiv = document.createElement('div')
    tempDiv.innerHTML = originalHtml

    interface WordInfo {
      word: string
      regex: RegExp
      colorCode: string
    }

    const wordInfos: WordInfo[] = wordKeys
      .map(word => ({
        word,
        regex: new RegExp(
          `\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
          'gi'
        ),
        colorCode: this.getColorCode(wordDict[word]),
      }))
      .sort((a, b) => b.word.length - a.word.length) // Longest first

    // Single TreeWalker traversal to collect all text nodes
    const walker = document.createTreeWalker(tempDiv, NodeFilter.SHOW_TEXT, {
      acceptNode: node => {
        const parent = node.parentElement
        if (!parent) return NodeFilter.FILTER_REJECT

        let current = parent
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
          current = current.parentElement!
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

    console.log(`Collected ${textNodes.length} text nodes for processing`)

    interface NodeReplacement {
      node: Text
      newContent: string
    }

    const replacements: NodeReplacement[] = []
    let totalReplacements = 0

    textNodes.forEach(textNode => {
      let text = textNode.textContent || ''
      let hasChanges = false

      // Use placeholders to avoid nested replacements
      const placeholders: { placeholder: string; html: string }[] = []
      let placeholderIndex = 0

      wordInfos.forEach(({ word, regex, colorCode }) => {
        if (regex.test(text)) {
          text = text.replace(regex, match => {
            totalReplacements++
            hasChanges = true

            const placeholder = `___ENX_PLACEHOLDER_${placeholderIndex++}___`
            const html = `<u class="enx-word enx-${word.toLowerCase()}" data-word="${match}" style="display: inline !important; text-decoration: ${colorCode} underline; text-decoration-thickness: 1px;">${match}</u>`

            placeholders.push({ placeholder, html })
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

    console.log(
      `Found ${replacements.length} nodes to replace with ${totalReplacements} total word matches`
    )

    // Batch DOM updates using DocumentFragment for better performance
    replacements.forEach(({ node, newContent }) => {
      const tempContainer = document.createElement('span')
      tempContainer.innerHTML = newContent

      const fragment = document.createDocumentFragment()
      while (tempContainer.firstChild) {
        fragment.appendChild(tempContainer.firstChild)
      }

      const parent = node.parentNode
      if (parent) {
        parent.replaceChild(fragment, node)
      }
    })

    const finalHtml = tempDiv.innerHTML
    if (finalHtml.includes('enx-word')) {
      const uTagsCount = (finalHtml.match(/<u[^>]*class="enx-word[^"]*"/g) || []).length
      const closingTagsCount = (finalHtml.match(/<\/u>/g) || []).length
      if (uTagsCount !== closingTagsCount) {
        console.error('⚠️ Tag mismatch! HTML structure may be broken')
      }
    }

    console.log('Word highlighting optimization completed')

    return tempDiv.innerHTML
  }

  // Returns every element on the page that should be treated as article
  // content. A selector can match more than one element (e.g. a short
  // intro block and the real article body sharing the same class) — all
  // of them get processed, not just the longest one.
  static getArticleNodes(): Element[] {
    const selectors = [
      '.Article', // BBC
      '.article__data', // InfoQ
      '.blog_post_content_wrap', // Claude blog (Webflow)
      '.post-content', // Blog posts
      '.single-post__container', // Microsoft Research
      '#EMAIL_CONTAINER', // NY Times
      '.text', // TingRoom
      '#lesson-main-content', // Anthropic Skilljar
      '.sjwc-lesson-content-item', // Anthropic Skilljar (inner)
      'article', // Semantic HTML5
      '.content',
      '.entry-content',
      '.post-body',
    ]

    for (const selector of selectors) {
      const matches = Array.from(document.querySelectorAll(selector)).filter(
        element => (element.textContent?.trim().length || 0) > 100
      )
      // Drop matches nested inside another match, so the same text isn't processed twice.
      const nodes = matches.filter(
        element => !matches.some(other => other !== element && other.contains(element))
      )

      if (nodes.length > 0) {
        console.log(`✅ Using article node with selector: ${selector}`)
        return nodes
      }
    }

    // Fallback: find the largest text container on the page
    const allElements = document.querySelectorAll('div, main, section, article')
    let largestElement: Element | null = null
    let maxTextLength = 0

    allElements.forEach(element => {
      const textLength = element.textContent?.length || 0
      if (textLength > maxTextLength && textLength > 500) {
        maxTextLength = textLength
        largestElement = element
      }
    })

    if (largestElement) {
      console.log(`✅ Fallback: Using largest element with ${maxTextLength} characters`)
      return [largestElement]
    }

    return []
  }

  // Strips <script>/<style>/<noscript> before reading textContent, so their
  // contents don't get picked up as word candidates by extractWords().
  static cleanArticleText(articleNode: Element): string {
    const clone = articleNode.cloneNode(true) as Element
    clone.querySelectorAll('script, style, noscript').forEach(el => el.remove())
    return clone.textContent || ''
  }
}
