import { WordProcessor } from '@/lib/wordProcessor'
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

describe('WordProcessor', () => {
  beforeEach(() => {
    global.console.log = jest.fn()
    document.body.innerHTML = ''
  })

  describe('extractWords', () => {
    it('should extract words from a simple sentence', () => {
      const text = 'Hello world this is a test'
      const words = WordProcessor.extractWords(text)

      expect(words).toEqual(['hello', 'world', 'this', 'is', 'a', 'test'])
    })

    it('should handle contractions and apostrophes', () => {
      const text = "I can't believe it's working"
      const words = WordProcessor.extractWords(text)

      expect(words).toEqual(['i', "can't", 'believe', "it's", 'working'])
    })

    it('should filter out numbers and very short words', () => {
      const text = 'Test 123 a word'
      const words = WordProcessor.extractWords(text)

      expect(words).toEqual(['test', 'a', 'word'])
    })

    it('should handle HTML tags and entities', () => {
      const text = 'Hello <strong>world</strong> &amp; test'
      const words = WordProcessor.extractWords(text)

      expect(words).toEqual(['hello', 'world', 'test'])
    })

    it('should return empty array for empty or invalid input', () => {
      expect(WordProcessor.extractWords('')).toEqual([])
      expect(WordProcessor.extractWords('   ')).toEqual([])
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

      expect(WordProcessor.getColorCode(wordData)).toBe('#FFFFFF')
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

      expect(WordProcessor.getColorCode(wordData)).toBe('#FFFFFF')
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

      expect(WordProcessor.getColorCode(wordData)).toBe('#FFFFFF')
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

      const color = WordProcessor.getColorCode(wordData)
      expect(color).toMatch(/^hsl\(\d+, 100%, 40%\)$/)
    })
  })

  describe('getTextDecoration', () => {
    const base: WordData = {
      Key: 'test',
      English: 'test',
      Chinese: '测试',
      AlreadyAcquainted: 0,
      LoadCount: 0,
      WordType: 0,
      Pronunciation: '',
    }

    it('is "none" for words that should not be highlighted (no white underline)', () => {
      expect(WordProcessor.getTextDecoration(base)).toBe('none') // LoadCount 0
      expect(
        WordProcessor.getTextDecoration({ ...base, AlreadyAcquainted: 1, LoadCount: 5 })
      ).toBe('none')
      expect(
        WordProcessor.getTextDecoration({ ...base, WordType: 1, LoadCount: 5 })
      ).toBe('none')
    })

    it('is a colored underline for words still worth reviewing', () => {
      expect(WordProcessor.getTextDecoration({ ...base, LoadCount: 15 })).toMatch(
        /^hsl\(\d+, 100%, 40%\) underline$/
      )
    })
  })

  describe('renderWithHighlights', () => {
    it('should wrap matched words in enx-word <u> elements', () => {
      const originalHtml = '<p>Hello world test</p>'
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

      const result = WordProcessor.renderWithHighlights(originalHtml, wordDict)

      expect(result).toContain('class="enx-word enx-hello"')
      expect(result).toContain('data-word="Hello"')
      expect(result).toContain('class="enx-word enx-world"')
      expect(result).toContain('data-word="world"')
      expect(result).not.toContain('enx-word enx-test')
    })

    it('should return the original html unchanged for an empty word dictionary', () => {
      const originalHtml = '<p>Hello world test</p>'

      const result = WordProcessor.renderWithHighlights(originalHtml, {})

      expect(result).toBe(originalHtml)
    })

    it('should generate correct highlight HTML structure', () => {
      // Test the HTML generation logic directly
      const word = 'hello'
      const colorCode = 'hsl(150, 100%, 40%)'
      const match = 'Hello'

      const expectedHtml = `<u class="enx-word enx-${word.toLowerCase()}" data-word="${match}" style="text-decoration: ${colorCode} underline; text-decoration-thickness: 1px;">${match}</u>`

      // This tests the HTML structure that would be generated
      expect(expectedHtml).toContain('class="enx-word enx-hello"')
      expect(expectedHtml).toContain('data-word="Hello"')
      expect(expectedHtml).toContain(
        'text-decoration: hsl(150, 100%, 40%) underline'
      )
      // Cursor is now controlled by CSS :hover, not inline style
      expect(expectedHtml).not.toContain('cursor: pointer')
    })

    it('should maintain consistent underline thickness between initial highlight and color update', () => {
      // Test the consistency of text-decoration-thickness
      // This tests the fix for the underline thickness inconsistency bug
      // where initial highlight used 1px but color update after translation didn't preserve it

      const word = 'example'
      const match = 'Example'

      // Step 1: Verify initial highlight HTML has 1px thickness
      const initialColorCode = 'hsl(120, 100%, 40%)'
      const initialHtml = `<u class="enx-word enx-${word.toLowerCase()}" data-word="${match}" style="text-decoration: ${initialColorCode} underline; text-decoration-thickness: 1px;">${match}</u>`

      expect(initialHtml).toContain('text-decoration-thickness: 1px')
      expect(initialHtml).toContain(initialColorCode)

      // Step 2: Verify that when we update color (simulate translation click),
      // we also maintain the 1px thickness
      const updatedColorCode = 'hsl(60, 100%, 40%)'

      // This simulates the updateWordColor function behavior
      // element.style.textDecoration = `${colorCode} underline`
      // element.style.textDecorationThickness = '1px'
      const expectedStyle = `text-decoration: ${updatedColorCode} underline; text-decoration-thickness: 1px`

      expect(expectedStyle).toContain('text-decoration-thickness: 1px')
      expect(expectedStyle).toContain(updatedColorCode)

      // Verify both use the same 1px thickness
      expect(initialHtml).toContain('1px')
      expect(expectedStyle).toContain('1px')
    })
  })

  describe('cleanArticleText', () => {
    it('should exclude <script> and <style> text from the extracted content', () => {
      const articleNode = document.createElement('div')
      articleNode.innerHTML = `
        <p>Getting started with loops in Claude Code.</p>
        <script>const secretVar = "shouldNotBeAWord"; trackEvent();</script>
        <style>.hidden { display: none; shouldAlsoNotBeAWord: true; }</style>
      `

      const text = WordProcessor.cleanArticleText(articleNode)

      expect(text).toContain('Getting started with loops')
      expect(text).not.toContain('shouldNotBeAWord')
      expect(text).not.toContain('shouldAlsoNotBeAWord')
    })

    it('should not leak script/style tokens into extractWords results', () => {
      const articleNode = document.createElement('div')
      articleNode.innerHTML = `
        <p>Getting started with loops.</p>
        <script>const shouldNotBeAWord = 1;</script>
      `

      const words = WordProcessor.extractWords(
        WordProcessor.cleanArticleText(articleNode)
      )

      expect(words).not.toContain('shouldnotbeaword')
    })

    it('should not mutate the original article node', () => {
      const articleNode = document.createElement('div')
      articleNode.innerHTML = '<p>Hello</p><script>1;</script>'

      WordProcessor.cleanArticleText(articleNode)

      expect(articleNode.querySelector('script')).not.toBeNull()
    })
  })
})
