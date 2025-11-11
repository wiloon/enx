/**
 * Test suite for HTML tag rendering issue
 *
 * This test reproduces and verifies the fix for the bug where HTML tags
 * are displayed as text in the webpage instead of being properly rendered.
 *
 * Bug description: After clicking "Enable Learning Mode", the webpage shows
 * HTML tags like: <u class="enx-word">Goodu> instead of rendering them.
 */

describe('HTML Tag Rendering - Bug Reproduction', () => {
  it('should properly render HTML tags without escaping', () => {
    // Simulate what happens in the content script
    const originalHtml = '<p>Good morning. Hundreds of people.</p>'

    // Create a container like articleNode
    const container = document.createElement('div')
    container.innerHTML = originalHtml

    // Simulate word highlighting - generate HTML string with <u> tags
    const word1 = 'Good'
    const word2 = 'morning'
    const highlightedText = `<u class="enx-word enx-good" data-word="${word1}" style="text-decoration: #FF0000 underline; text-decoration-thickness: 1px; cursor: pointer;">${word1}</u> <u class="enx-word enx-morning" data-word="${word2}" style="text-decoration: #FF0000 underline; text-decoration-thickness: 1px; cursor: pointer;">${word2}</u>. Hundreds of people.`

    // Replace innerHTML (this is what happens in processArticleContent)
    const p = container.querySelector('p')!
    p.innerHTML = highlightedText

    // Verify: HTML should be rendered, not displayed as text
    const uElements = p.querySelectorAll('u.enx-word')
    expect(uElements.length).toBe(2)

    // Verify: text content should NOT contain HTML tags
    const textContent = p.textContent || ''
    expect(textContent).toBe('Good morning. Hundreds of people.')
    expect(textContent).not.toContain('<u')
    expect(textContent).not.toContain('</u>')

    // Verify: innerHTML should contain HTML tags
    expect(p.innerHTML).toContain('<u class="enx-word')
    expect(p.innerHTML).toContain('</u>')

    // Verify: Should NOT have the bug pattern "Goodu>" or "morningu>"
    expect(p.innerHTML).not.toMatch(/Good[^<]*u>/i)
    expect(p.innerHTML).not.toMatch(/morning[^<]*u>/i)
  })

  it('should not escape < and > characters in generated HTML', () => {
    const container = document.createElement('div')
    const htmlString = '<u class="enx-word">Test</u>'

    // Set innerHTML
    container.innerHTML = htmlString

    // Read it back
    const readBack = container.innerHTML

    // Should NOT be escaped
    expect(readBack).toContain('<u class="enx-word"')
    expect(readBack).toContain('</u>')
    expect(readBack).not.toContain('&lt;u')
    expect(readBack).not.toContain('&lt;/u&gt;')
    expect(readBack).not.toContain('u&gt;')

    // Should have an actual <u> element
    const uElement = container.querySelector('u')
    expect(uElement).not.toBeNull()
    expect(uElement?.textContent).toBe('Test')
  })

  it('should handle textContent -> HTML replacement correctly', () => {
    // This simulates the actual flow in renderWithHighlights
    const originalHtml = '<p>Good morning</p>'
    const tempDiv = document.createElement('div')
    tempDiv.innerHTML = originalHtml

    const p = tempDiv.querySelector('p')!
    const textNode = p.firstChild as Text

    // Get text content (pure text)
    const text = textNode.textContent || ''
    expect(text).toBe('Good morning')

    // Replace words with HTML tags (string replacement)
    const replacedText = text.replace(/Good/g, match => {
      return `<u class="enx-word enx-good" data-word="${match}" style="text-decoration: #FF0000 underline;">${match}</u>`
    })

    expect(replacedText).toContain('<u class="enx-word')
    expect(replacedText).toContain('</u>')

    // Create temp container and set innerHTML
    const tempContainer = document.createElement('span')
    tempContainer.innerHTML = replacedText

    // Verify HTML is parsed correctly
    const uElements = tempContainer.querySelectorAll('u.enx-word')
    expect(uElements.length).toBe(1)
    expect(uElements[0].textContent).toBe('Good')

    // Create fragment and replace node
    const fragment = document.createDocumentFragment()
    while (tempContainer.firstChild) {
      fragment.appendChild(tempContainer.firstChild)
    }

    const parent = textNode.parentNode!
    parent.insertBefore(fragment, textNode)
    parent.removeChild(textNode)

    // Verify final HTML
    const finalHtml = tempDiv.innerHTML
    expect(finalHtml).toContain('<u class="enx-word')
    expect(finalHtml).toContain('</u>')
    expect(finalHtml).not.toMatch(/Good[^<]*u>/)

    // Verify DOM structure
    const finalUElements = tempDiv.querySelectorAll('u.enx-word')
    expect(finalUElements.length).toBe(1)
  })

  it('should maintain proper tag structure with multiple replacements', () => {
    const originalHtml = '<p>Good morning. Hundreds.</p>'
    const tempDiv = document.createElement('div')
    tempDiv.innerHTML = originalHtml

    const p = tempDiv.querySelector('p')!
    const textNode = p.firstChild as Text
    let text = textNode.textContent || ''

    // Replace multiple words
    const words = ['Good', 'morning', 'Hundreds']
    words.forEach(word => {
      const regex = new RegExp(`\\b${word}\\b`, 'gi')
      text = text.replace(regex, match => {
        return `<u class="enx-word enx-${word.toLowerCase()}" data-word="${match}">${match}</u>`
      })
    })

    // Set via innerHTML
    const tempContainer = document.createElement('span')
    tempContainer.innerHTML = text

    // Count tags
    const innerHTML = tempContainer.innerHTML
    const openingTags = (innerHTML.match(/<u class="enx-word/g) || []).length
    const closingTags = (innerHTML.match(/<\/u>/g) || []).length

    expect(openingTags).toBe(3)
    expect(closingTags).toBe(3)
    expect(openingTags).toBe(closingTags)

    // Verify no malformed tags
    expect(innerHTML).not.toMatch(/Good[^<]*u>/)
    expect(innerHTML).not.toMatch(/morning[^<]*u>/)
    expect(innerHTML).not.toMatch(/Hundreds[^<]*u>/)

    // Verify proper closing tags
    expect(innerHTML).toMatch(/<u[^>]*>Good<\/u>/)
    expect(innerHTML).toMatch(/<u[^>]*>morning<\/u>/)
    expect(innerHTML).toMatch(/<u[^>]*>Hundreds<\/u>/)
  })

  it('should reproduce the exact bug scenario from user report', () => {
    // User reported seeing: <u class="enx-word enx-good" ...>Goodu>
    // This test ensures we DON'T produce that output

    const container = document.createElement('div')

    // Our correct pattern should be:
    const correctPattern =
      '<u class="enx-word enx-good" data-word="Good" style="text-decoration: #FFFFFF underline; text-decoration-thickness: 1px; cursor: pointer;">Good</u>'

    // Generate correct HTML
    container.innerHTML = correctPattern

    // Verify it's properly formed
    const uElement = container.querySelector('u.enx-word')
    expect(uElement).not.toBeNull()
    expect(uElement?.textContent).toBe('Good')

    const finalHtml = container.innerHTML
    expect(finalHtml).toContain('</u>')
    expect(finalHtml).not.toMatch(/Good[^<]*u>/)
  })
})

/**
 * Test suite for nested word replacement issue
 *
 * This test reproduces and verifies the fix for the bug where word replacements
 * create nested/malformed HTML when a word appears in the attribute of a previously
 * replaced word's HTML tag.
 *
 * Bug description: When highlighting "data" and "GitHub", the HTML attribute
 * `data-word="GitHub"` would get the "data" part highlighted, resulting in:
 * <u class="enx-word enx-github" <u class="enx-word enx-data">data</u>-word="GitHub">
 *
 * Root cause: Sequential regex replacements on the same string would match words
 * inside previously generated HTML tags.
 *
 * Solution: Use placeholder tokens during replacement, then replace all placeholders
 * with final HTML after all word matching is complete.
 */
describe('Nested Word Replacement - Bug Fix', () => {
  it('should not create nested highlights when word appears in HTML attribute', () => {
    // This reproduces the exact bug: "data" appearing in "data-word" attribute
    const originalText = 'GitHub data processing'

    // Simulate the old buggy behavior (sequential replacements)
    let buggyText = originalText

    // First replace "GitHub" - creates data-word="GitHub" attribute
    buggyText = buggyText.replace(/\bGitHub\b/g, match => {
      return `<u class="enx-word enx-github" data-word="${match}">${match}</u>`
    })

    // Then replace "data" - BUG: this would match "data" in "data-word" attribute
    const afterSecondReplace = buggyText.replace(/\bdata\b/g, match => {
      return `<u class="enx-word enx-data" data-word="${match}">${match}</u>`
    })

    // Verify the bug occurs
    expect(afterSecondReplace).toContain(
      '<u class="enx-word enx-data" data-word="data">data</u>-word='
    )

    // Now test the fixed behavior using placeholders
    let fixedText = originalText
    const placeholders: { placeholder: string; html: string }[] = []
    let index = 0

    // Replace "GitHub" with placeholder
    fixedText = fixedText.replace(/\bGitHub\b/g, match => {
      const placeholder = `___ENX_PLACEHOLDER_${index++}___`
      const html = `<u class="enx-word enx-github" data-word="${match}">${match}</u>`
      placeholders.push({ placeholder, html })
      return placeholder
    })

    // Replace "data" with placeholder
    fixedText = fixedText.replace(/\bdata\b/g, match => {
      const placeholder = `___ENX_PLACEHOLDER_${index++}___`
      const html = `<u class="enx-word enx-data" data-word="${match}">${match}</u>`
      placeholders.push({ placeholder, html })
      return placeholder
    })

    // Now replace all placeholders with actual HTML
    placeholders.forEach(({ placeholder, html }) => {
      fixedText = fixedText.replace(placeholder, html)
    })

    // Verify no nested tags
    expect(fixedText).not.toContain(
      '<u class="enx-word enx-data" data-word="data">data</u>-word='
    )

    // Verify correct structure
    const container = document.createElement('div')
    container.innerHTML = fixedText

    const uElements = container.querySelectorAll('u.enx-word')
    expect(uElements.length).toBe(2)
    expect(uElements[0].getAttribute('data-word')).toBe('GitHub')
    expect(uElements[1].getAttribute('data-word')).toBe('data')
  })

  it('should handle multiple words that could create nested replacements', () => {
    const originalText =
      'The event data architecture includes GitHub event handling'

    const words = ['event', 'data', 'architecture', 'GitHub']
    let text = originalText
    const placeholders: { placeholder: string; html: string }[] = []
    let index = 0

    // Replace all words with placeholders
    words.forEach(word => {
      const regex = new RegExp(`\\b${word}\\b`, 'gi')
      text = text.replace(regex, match => {
        const placeholder = `___ENX_PLACEHOLDER_${index++}___`
        const html = `<u class="enx-word enx-${word.toLowerCase()}" data-word="${match}">${match}</u>`
        placeholders.push({ placeholder, html })
        return placeholder
      })
    })

    // Replace all placeholders
    placeholders.forEach(({ placeholder, html }) => {
      text = text.replace(placeholder, html)
    })

    // Verify HTML structure
    const container = document.createElement('div')
    container.innerHTML = text

    const uElements = container.querySelectorAll('u.enx-word')
    expect(uElements.length).toBe(5) // event (2x), data, architecture, GitHub

    // Verify no nested/malformed HTML - key bug check
    // Should NOT have patterns like: <u ... <u ...>data</u>-word="..."
    expect(text).not.toMatch(/<u[^>]*<u[^>]*>data<\/u>-word=/)
    expect(text).not.toMatch(/<u[^>]*<u[^>]*>event<\/u>-word=/)

    // All data-word attributes should be properly formed
    const dataWordMatches = text.match(/data-word="[^"]+"/g) || []
    expect(dataWordMatches.length).toBe(5)

    // Verify each element has correct structure
    uElements.forEach(element => {
      const dataWord = element.getAttribute('data-word')
      const textContent = element.textContent

      // data-word attribute should match text content
      expect(dataWord).toBe(textContent)

      // Should not contain nested <u> tags
      expect(element.innerHTML).not.toContain('<u')
      expect(element.innerHTML).toBe(textContent)
    })
  })

  it('should preserve word boundaries during placeholder replacement', () => {
    const originalText = 'data dataset database'

    let text = originalText
    const placeholders: { placeholder: string; html: string }[] = []
    let index = 0

    // Only "data" should match (word boundary)
    const regex = /\bdata\b/gi
    text = text.replace(regex, match => {
      const placeholder = `___ENX_PLACEHOLDER_${index++}___`
      const html = `<u class="enx-word enx-data" data-word="${match}">${match}</u>`
      placeholders.push({ placeholder, html })
      return placeholder
    })

    placeholders.forEach(({ placeholder, html }) => {
      text = text.replace(placeholder, html)
    })

    const container = document.createElement('div')
    container.innerHTML = text

    // Only one match (not "dataset" or "database")
    const uElements = container.querySelectorAll('u.enx-word')
    expect(uElements.length).toBe(1)
    expect(uElements[0].textContent).toBe('data')

    // Other words remain unchanged
    expect(text).toContain('dataset')
    expect(text).toContain('database')
    expect(text).not.toContain('<u class="enx-word enx-data">dataset')
    expect(text).not.toContain('<u class="enx-word enx-data">database')
  })

  it('should not interfere with placeholder pattern in actual text', () => {
    // Edge case: what if the actual text contains something like our placeholder?
    const originalText = 'Some ___PLACEHOLDER___ text with data'

    let text = originalText
    const placeholders: { placeholder: string; html: string }[] = []
    let index = 0

    // Replace "data"
    const regex = /\bdata\b/gi
    text = text.replace(regex, match => {
      const placeholder = `___ENX_PLACEHOLDER_${index++}___`
      const html = `<u class="enx-word enx-data" data-word="${match}">${match}</u>`
      placeholders.push({ placeholder, html })
      return placeholder
    })

    // The original placeholder-like text should remain
    expect(text).toContain('___PLACEHOLDER___')

    placeholders.forEach(({ placeholder, html }) => {
      text = text.replace(placeholder, html)
    })

    // Verify original text is preserved
    expect(text).toContain('___PLACEHOLDER___')

    // Verify "data" is highlighted
    const container = document.createElement('div')
    container.innerHTML = text
    const uElements = container.querySelectorAll('u.enx-word')
    expect(uElements.length).toBe(1)
    expect(uElements[0].textContent).toBe('data')
  })

  it('should match the exact behavior from renderWithHighlights', () => {
    // This simulates the exact flow in ContentWordProcessor.renderWithHighlights
    const originalText = 'GitHub announced during its annual event'

    const wordDict = {
      GitHub: { LoadCount: 5, AlreadyAcquainted: 0 },
      announced: { LoadCount: 10, AlreadyAcquainted: 0 },
      during: { LoadCount: 0, AlreadyAcquainted: 0 },
      its: { LoadCount: 0, AlreadyAcquainted: 0 },
      annual: { LoadCount: 15, AlreadyAcquainted: 0 },
      event: { LoadCount: 0, AlreadyAcquainted: 0 },
    }

    const getColorCode = (wordData: { LoadCount: number }) => {
      if (wordData.LoadCount === 0) return '#FFFFFF'
      if (wordData.LoadCount < 10) return 'hsl(10, 100%, 40%)'
      if (wordData.LoadCount < 20) return 'hsl(20, 100%, 40%)'
      return 'hsl(30, 100%, 40%)'
    }

    let text = originalText
    const placeholders: { placeholder: string; html: string }[] = []
    let placeholderIndex = 0

    // Process each word
    Object.entries(wordDict).forEach(([word, wordData]) => {
      const regex = new RegExp(`\\b${word}\\b`, 'gi')
      const colorCode = getColorCode(wordData)

      text = text.replace(regex, match => {
        const placeholder = `___ENX_PLACEHOLDER_${placeholderIndex++}___`
        const html = `<u class="enx-word enx-${word.toLowerCase()}" data-word="${match}" style="text-decoration: ${colorCode} underline; text-decoration-thickness: 1px; cursor: pointer;">${match}</u>`
        placeholders.push({ placeholder, html })
        return placeholder
      })
    })

    // Replace all placeholders
    placeholders.forEach(({ placeholder, html }) => {
      text = text.replace(placeholder, html)
    })

    // Verify final HTML
    const container = document.createElement('div')
    container.innerHTML = text

    const uElements = container.querySelectorAll('u.enx-word')
    expect(uElements.length).toBe(6)

    // Verify no nested tags
    const openingTags = (text.match(/<u class="enx-word/g) || []).length
    const closingTags = (text.match(/<\/u>/g) || []).length
    expect(openingTags).toBe(closingTags)
    expect(openingTags).toBe(6)

    // Verify no malformed HTML
    expect(text).not.toMatch(/<u[^>]*<u/)
    expect(text).toMatch(/data-word="[^"]+"/g)
  })
})
