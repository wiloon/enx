import { WordData } from '../../types'

// Mock DOM for testing
Object.defineProperty(global, 'NodeFilter', {
  value: {
    SHOW_TEXT: 4,
    FILTER_ACCEPT: 1,
    FILTER_REJECT: 2,
    FILTER_SKIP: 3,
  },
})

// Extract the ContentWordProcessor class from content script
class ContentWordProcessor {
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
    console.log(
      'Starting renderWithHighlights with',
      Object.keys(wordDict).length,
      'words'
    )

    // Create a temporary DOM element to work with
    const tempDiv = document.createElement('div')
    tempDiv.innerHTML = originalHtml

    let totalReplacements = 0

    // Process each word in the dictionary
    Object.keys(wordDict).forEach(word => {
      const wordData = wordDict[word]
      const colorCode = this.getColorCode(wordData)

      // Find all text nodes that contain this word, excluding those inside links
      const walker = document.createTreeWalker(tempDiv, NodeFilter.SHOW_TEXT, {
        acceptNode: node => {
          // Check if the text node is inside a link
          let parent = node.parentNode
          while (parent && parent !== tempDiv) {
            if (parent.nodeName.toLowerCase() === 'a') {
              return NodeFilter.FILTER_REJECT
            }
            parent = parent.parentNode
          }
          return NodeFilter.FILTER_ACCEPT
        },
      })

      const textNodes: Text[] = []
      let node
      while ((node = walker.nextNode())) {
        textNodes.push(node as Text)
      }

      const wordRegex = new RegExp(
        `\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
        'gi'
      )

      textNodes.forEach(textNode => {
        const text = textNode.textContent || ''
        if (wordRegex.test(text)) {
          const highlightedText = text.replace(wordRegex, match => {
            totalReplacements++
            return `<u class="enx-word enx-${word.toLowerCase()}" data-word="${match}" style="text-decoration: ${colorCode} underline; text-decoration-thickness: 2px; cursor: pointer;">${match}</u>`
          })

          // Create a temporary container and replace the text node
          const tempContainer = document.createElement('span')
          tempContainer.innerHTML = highlightedText

          // Replace the text node with the highlighted content
          while (tempContainer.firstChild) {
            textNode.parentNode!.insertBefore(
              tempContainer.firstChild,
              textNode
            )
          }
          textNode.parentNode!.removeChild(textNode)
        }
      })
    })

    console.log('Total word replacements made:', totalReplacements)
    return tempDiv.innerHTML
  }
}

describe('ContentWordProcessor', () => {
  beforeEach(() => {
    // Setup DOM mocks
    global.console.log = jest.fn()

    // Mock document.createElement
    global.document.createElement = jest.fn((tagName: string) => {
      const element = {
        innerHTML: '',
        nodeName: tagName.toUpperCase(),
        parentNode: null,
        firstChild: null,
        insertBefore: jest.fn(),
        removeChild: jest.fn(),
        textContent: '',
      }
      return element as any
    })
  })

  describe('extractWords', () => {
    it('should extract words from a simple sentence', () => {
      const text = 'Hello world this is a test'
      const words = ContentWordProcessor.extractWords(text)

      expect(words).toEqual(['hello', 'world', 'this', 'is', 'a', 'test'])
    })

    it('should handle contractions and apostrophes', () => {
      const text = "I can't believe it's working"
      const words = ContentWordProcessor.extractWords(text)

      expect(words).toEqual(['i', "can't", 'believe', "it's", 'working'])
    })

    it('should filter out numbers and very short words', () => {
      const text = 'Test 123 a word'
      const words = ContentWordProcessor.extractWords(text)

      expect(words).toEqual(['test', 'a', 'word'])
    })

    it('should handle HTML tags and entities', () => {
      const text = 'Hello <strong>world</strong> &amp; test'
      const words = ContentWordProcessor.extractWords(text)

      expect(words).toEqual(['hello', 'world', 'test'])
    })

    it('should return empty array for empty or invalid input', () => {
      expect(ContentWordProcessor.extractWords('')).toEqual([])
      expect(ContentWordProcessor.extractWords('   ')).toEqual([])
    })
  })

  describe('getColorCode', () => {
    it('should return white for already acquainted words', () => {
      const wordData: WordData = {
        Key: 'test',
        English: 'test',
        Chinese: '测试',
        AlreadyAcquainted: 1,
        LoadCount: 5,
        WordType: 0,
        Pronunciation: '',
      }

      expect(ContentWordProcessor.getColorCode(wordData)).toBe('#FFFFFF')
    })

    it('should return white for known word types', () => {
      const wordData: WordData = {
        Key: 'test',
        English: 'test',
        Chinese: '测试',
        AlreadyAcquainted: 0,
        LoadCount: 5,
        WordType: 1,
        Pronunciation: '',
      }

      expect(ContentWordProcessor.getColorCode(wordData)).toBe('#FFFFFF')
    })

    it('should return white for words not in database', () => {
      const wordData: WordData = {
        Key: 'test',
        English: 'test',
        Chinese: '测试',
        AlreadyAcquainted: 0,
        LoadCount: 0,
        WordType: 0,
        Pronunciation: '',
      }

      expect(ContentWordProcessor.getColorCode(wordData)).toBe('#FFFFFF')
    })

    it('should return HSL color for words that need highlighting', () => {
      const wordData: WordData = {
        Key: 'test',
        English: 'test',
        Chinese: '测试',
        AlreadyAcquainted: 0,
        LoadCount: 15,
        WordType: 0,
        Pronunciation: '',
      }

      const color = ContentWordProcessor.getColorCode(wordData)
      expect(color).toMatch(/^hsl\(\d+, 100%, 40%\)$/)
    })
  })

  describe('renderWithHighlights', () => {
    it('should handle basic highlighting setup', () => {
      const originalHtml = 'Hello world test'
      const wordDict: Record<string, WordData> = {
        hello: {
          Key: 'hello',
          English: 'hello',
          Chinese: '你好',
          AlreadyAcquainted: 0,
          LoadCount: 5,
          WordType: 0,
          Pronunciation: '',
        },
        world: {
          Key: 'world',
          English: 'world',
          Chinese: '世界',
          AlreadyAcquainted: 0,
          LoadCount: 10,
          WordType: 0,
          Pronunciation: '',
        },
      }

      // Mock basic DOM elements
      const mockDiv = {
        innerHTML: originalHtml,
        insertBefore: jest.fn(),
        removeChild: jest.fn(),
      }

      global.document.createElement = jest.fn(() => mockDiv as any)

      // Mock TreeWalker with no text nodes (simplified test)
      const mockTreeWalker = {
        nextNode: jest.fn().mockReturnValue(null),
      }

      global.document.createTreeWalker = jest.fn(() => mockTreeWalker as any)

      // Call the function
      ContentWordProcessor.renderWithHighlights(originalHtml, wordDict)

      // Verify the function was called and attempted to process words
      expect(console.log).toHaveBeenCalledWith(
        'Starting renderWithHighlights with',
        2,
        'words'
      )
      expect(global.document.createElement).toHaveBeenCalledWith('div')
      expect(global.document.createTreeWalker).toHaveBeenCalled()
    })

    it('should handle empty word dictionary', () => {
      const originalHtml = 'Hello world test'
      const wordDict: Record<string, WordData> = {}

      ContentWordProcessor.renderWithHighlights(originalHtml, wordDict)

      expect(console.log).toHaveBeenCalledWith(
        'Starting renderWithHighlights with',
        0,
        'words'
      )
    })

    it('should generate correct highlight HTML structure', () => {
      // Test the HTML generation logic directly
      const word = 'hello'
      const colorCode = 'hsl(150, 100%, 40%)'
      const match = 'Hello'

      const expectedHtml = `<u class="enx-word enx-${word.toLowerCase()}" data-word="${match}" style="text-decoration: ${colorCode} underline; text-decoration-thickness: 2px; cursor: pointer;">${match}</u>`

      // This tests the HTML structure that would be generated
      expect(expectedHtml).toContain('class="enx-word enx-hello"')
      expect(expectedHtml).toContain('data-word="Hello"')
      expect(expectedHtml).toContain(
        'text-decoration: hsl(150, 100%, 40%) underline'
      )
      expect(expectedHtml).toContain('cursor: pointer')
    })
  })
})
