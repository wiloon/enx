import { WordProcessor } from '@/lib/wordProcessor'

// ADR-011: the element-wrapping highlight path is gone. `getColorCode`,
// `getTextDecoration`, `renderWithHighlights`, `applyHighlightsTo*`, the
// flex-container fix and their tests were removed; the CSS Custom Highlight
// API path (`reviewBucket` / `buildHighlightRanges` / `expandToWordRange` /
// `applyHighlights`) is covered in `src/lib/__tests__/highlightRanges.test.ts`.
// What stays here: word extraction and article-text cleaning, both kept.

describe('WordProcessor', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  describe('extractWords', () => {
    it('should extract words from a simple sentence', () => {
      const text = 'Hello world this is a test'
      expect(WordProcessor.extractWords(text)).toEqual([
        'hello',
        'world',
        'this',
        'is',
        'a',
        'test',
      ])
    })

    it('should handle contractions and apostrophes', () => {
      const text = "I can't believe it's working"
      expect(WordProcessor.extractWords(text)).toEqual([
        'i',
        "can't",
        'believe',
        "it's",
        'working',
      ])
    })

    it('should filter out numbers and very short words', () => {
      expect(WordProcessor.extractWords('Test 123 a word')).toEqual([
        'test',
        'a',
        'word',
      ])
    })

    it('should handle HTML tags and entities', () => {
      const text = 'Hello <strong>world</strong> &amp; test'
      expect(WordProcessor.extractWords(text)).toEqual(['hello', 'world', 'test'])
    })

    it('should return empty array for empty or invalid input', () => {
      expect(WordProcessor.extractWords('')).toEqual([])
      expect(WordProcessor.extractWords('   ')).toEqual([])
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
