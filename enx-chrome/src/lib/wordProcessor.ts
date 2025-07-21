import { WordData } from '@/types'

// Word processing utilities based on original content_module.js
export class WordProcessor {
  // Enhanced regex patterns for word identification
  private static readonly WORD_PATTERNS = {
    // Basic English word pattern
    basicWord: /\b[a-zA-Z][a-zA-Z'-]*[a-zA-Z]\b|\b[a-zA-Z]\b/g,
    // Words with smart quotes and contractions
    contractedWord: /\b[a-zA-Z][a-zA-Z'''-]*[a-zA-Z]\b|\b[a-zA-Z]\b/g,
    // Hyphenated words
    hyphenatedWord: /\b[a-zA-Z]+(?:-[a-zA-Z]+)*\b/g,
    // HTML entities to ignore
    htmlEntity: /&[a-zA-Z0-9#]+;/g,
    // HTML tags to ignore
    htmlTag: /<[^>]*>/g,
  }

  // Color coding constants
  private static readonly COLOR_CONFIG = {
    maxCount: 30,
    acquaintedColor: '#FFFFFF',
    defaultHue: 300,
  }

  /**
   * Extract English words from text content
   */
  static extractWords(text: string): string[] {
    if (!text || text.trim() === '') {
      return []
    }

    // Remove HTML tags and entities
    const cleanText = text
      .replace(this.WORD_PATTERNS.htmlTag, ' ')
      .replace(this.WORD_PATTERNS.htmlEntity, ' ')

    // Extract words using enhanced pattern
    const words = cleanText.match(this.WORD_PATTERNS.contractedWord) || []

    // Filter and clean words
    return words
      .map(word => word.trim())
      .filter(word => {
        // Filter out empty words, numbers, and very short words
        return word.length > 0 && 
               word.length <= 50 && 
               !/^\d+$/.test(word) &&
               /[a-zA-Z]/.test(word)
      })
      .map(word => word.toLowerCase())
  }

  /**
   * Process paragraph and split into chunks for API calls
   */
  static processIntoChunks(text: string, maxChunkSize: number = 5000): string[] {
    const words = this.extractWords(text)
    const chunks: string[] = []
    let currentChunk = ''

    for (const word of words) {
      const testChunk = currentChunk ? `${currentChunk} ${word}` : word
      
      if (testChunk.length > maxChunkSize && currentChunk) {
        chunks.push(currentChunk)
        currentChunk = word
      } else {
        currentChunk = testChunk
      }
    }

    if (currentChunk) {
      chunks.push(currentChunk)
    }

    return chunks
  }

  /**
   * Generate color code based on word familiarity
   */
  static getColorCode(wordData: WordData): string {
    if (wordData.AlreadyAcquainted === 1 || wordData.WordType === 1) {
      // add console log for debugging
      console.log(`Word "${wordData.Key}" is already acquainted or a special type.`)
      return this.COLOR_CONFIG.acquaintedColor
    }

    const { LoadCount = 0 } = wordData
    const normalizedCount = Math.min(LoadCount, this.COLOR_CONFIG.maxCount) / this.COLOR_CONFIG.maxCount
    const hue = Math.round(this.COLOR_CONFIG.defaultHue * normalizedCount)
    // add console log for debugging
    let colorCode = `hsl(${hue}, 100%, 40%)`
    console.log(`Word "${wordData.Key}" has LoadCount ${LoadCount}, color code ${colorCode}`)
    return colorCode
  }

  /**
   * Render HTML with word highlighting
   */
  static renderWithHighlights(
    originalHtml: string, 
    wordDict: Record<string, WordData>
  ): string {
    let processedHtml = originalHtml

    // Process each word in the dictionary
    Object.keys(wordDict).forEach(word => {
      const wordData = wordDict[word]
      const colorCode = this.getColorCode(wordData)
      
      // Create case-insensitive regex for word replacement
      const wordRegex = new RegExp(
        `\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
        'gi'
      )
      // add console log for debugging
      console.log('highlight word:', word, 'colorCode:', colorCode)
      // Replace with highlighted version
      processedHtml = processedHtml.replace(wordRegex, (match) => {
        return `<u class="enx-${word}" alt="${match}" style="margin-left: 2px; margin-right: 2px; text-decoration: ${colorCode} underline; text-decoration-thickness: 2px; cursor: pointer;">${match}</u>`
      })
    })

    return processedHtml
  }

  /**
   * Find text nodes in DOM tree for processing
   */
  static findTextNodes(rootNode: Node): Array<{ node: Node; text: string }> {
    const textNodes: Array<{ node: Node; text: string }> = []
    const walker = document.createTreeWalker(
      rootNode,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          // Skip script and style elements
          const parent = node.parentElement
          if (parent && ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(parent.tagName)) {
            return NodeFilter.FILTER_REJECT
          }
          
          // Only include nodes with meaningful text
          const text = node.textContent?.trim() || ''
          if (text.length > 0 && /[a-zA-Z]/.test(text)) {
            return NodeFilter.FILTER_ACCEPT
          }
          
          return NodeFilter.FILTER_REJECT
        }
      }
    )

    let node
    while (node = walker.nextNode()) {
      textNodes.push({
        node,
        text: node.textContent || ''
      })
    }

    return textNodes
  }

  /**
   * Get article content node for different websites
   */
  static getArticleNode(): Element | null {
    // Try different selectors based on popular websites
    const selectors = [
      '.Article',           // BBC, general articles
      '.article__data',     // InfoQ
      '.post-content',      // Blog posts
      '#EMAIL_CONTAINER',   // NY Times newsletters
      '.text',              // TingRoom
      'article',            // Semantic HTML5
      '.content',           // Generic content
      '.entry-content',     // WordPress
      '.post-body',         // Blogger
    ]

    for (const selector of selectors) {
      const element = document.querySelector(selector)
      if (element && element.textContent && element.textContent.trim().length > 100) {
        return element
      }
    }

    // Fallback: try to find the largest text container
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

    return largestElement
  }

  /**
   * Clean up word highlighting
   */
  static removeHighlights(rootNode: Element): void {
    const highlightedElements = rootNode.querySelectorAll('u[class^="enx-"]')
    highlightedElements.forEach(element => {
      const textContent = element.textContent || ''
      element.replaceWith(document.createTextNode(textContent + ' '))
    })
  }

  /**
   * Validate word for processing
   */
  static isValidWord(word: string): boolean {
    if (!word || typeof word !== 'string') return false
    
    // Basic validation
    const trimmed = word.trim()
    if (trimmed.length === 0 || trimmed.length > 50) return false
    
    // Must contain at least one letter
    if (!/[a-zA-Z]/.test(trimmed)) return false
    
    // Skip pure numbers
    if (/^\d+$/.test(trimmed)) return false
    
    // Skip common stop words that don't need translation
    const stopWords = ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'must']
    if (stopWords.includes(trimmed.toLowerCase())) return false
    
    return true
  }
}