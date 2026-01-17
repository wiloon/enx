/**
 * Test suite for whitespace preservation issue
 *
 * Bug description: After highlighting words, spaces between words are lost in the rendered HTML.
 * This happens specifically with text like "Claude Code's creator, Boris Cherny, "
 * where words are wrapped in <u> tags but spaces between them disappear.
 *
 * Example:
 * - Expected: "Claude Code's creator, Boris Cherny"
 * - Actual: "ClaudeCode'screator,BorisCherny"
 */

describe('Whitespace Preservation - Bug Reproduction', () => {
  it('should preserve spaces between highlighted words', () => {
    // Original text with spaces
    const originalText = "Claude Code's creator, Boris Cherny, "

    // Simulate word highlighting replacement
    let text = originalText
    const words = ['Claude', "Code's", 'creator', 'Boris', 'Cherny']

    // Replace each word with <u> tag (like the actual code does)
    words.forEach(word => {
      const regex = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi')
      text = text.replace(regex, match => {
        return `<u class="enx-word enx-${word.toLowerCase()}" data-word="${match}" style="text-decoration: #FFFFFF underline; text-decoration-thickness: 1px;">${match}</u>`
      })
    })

    // Verify: The replaced string should still contain spaces
    console.log('Replaced text:', text)
    expect(text).toContain('</u> <u') // Space between closing and opening tags
    expect(text).toContain('</u>, <u') // Space and comma
    expect(text).toContain('</u>, ') // Space and comma at the end

    // Simulate DOM manipulation (like the actual code does)
    const tempContainer = document.createElement('span')
    tempContainer.innerHTML = text

    // Get the rendered text content
    const renderedText = tempContainer.textContent || ''
    console.log('Rendered text:', renderedText)

    // BUG CHECK: Text content should preserve original spacing
    expect(renderedText).toBe(originalText)
    expect(renderedText).toContain(' ') // Should have spaces
    expect(renderedText).not.toBe("ClaudeCode'screator,BorisCherny,") // Should NOT be without spaces

    // Verify: Should have proper spacing between words
    expect(renderedText).toMatch(/Claude\s+Code's/)
    expect(renderedText).toMatch(/Code's\s+creator/)
    expect(renderedText).toMatch(/creator,\s+Boris/)
    expect(renderedText).toMatch(/Boris\s+Cherny/)
  })

  it('should preserve spaces when replacing text node with fragment', () => {
    // Create a DOM structure similar to InfoQ article
    const container = document.createElement('div')
    container.innerHTML = '<p><span>Claude Code\'s creator, Boris Cherny, </span></p>'

    const span = container.querySelector('span')!
    const textNode = span.firstChild as Text
    const originalText = textNode.textContent || ''

    // Simulate word replacement
    let text = originalText
    const words = ['Claude', "Code's", 'creator', 'Boris', 'Cherny']

    words.forEach(word => {
      const regex = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi')
      text = text.replace(regex, match => {
        return `<u class="enx-word enx-${word.toLowerCase()}" data-word="${match}" style="text-decoration: #FFFFFF underline; text-decoration-thickness: 1px;">${match}</u>`
      })
    })

    // Parse HTML and create fragment (like the actual code)
    const tempContainer = document.createElement('span')
    tempContainer.innerHTML = text

    const fragment = document.createDocumentFragment()
    while (tempContainer.firstChild) {
      fragment.appendChild(tempContainer.firstChild)
    }

    // Replace the text node with the fragment
    const parent = textNode.parentNode!
    parent.replaceChild(fragment, textNode)

    // Verify: Final text should preserve spaces
    const finalText = span.textContent || ''
    console.log('Final text:', finalText)
    console.log('Original text:', originalText)

    expect(finalText).toBe(originalText)
    expect(finalText).toContain(' ') // Should have spaces
    expect(finalText).toMatch(/Claude\s+Code's/)
    expect(finalText).toMatch(/Boris\s+Cherny/)
  })

  it('should handle multiple text nodes with spaces correctly', () => {
    // Simulate complex HTML structure like InfoQ
    const container = document.createElement('div')
    container.innerHTML = `
      <p>
        <span>Claude Code's creator, Boris Cherny, </span>
        <a href="#">described how he uses Claude Code at Anthropic</a>
      </p>
    `

    const span = container.querySelector('span')!
    const textNode = span.firstChild as Text

    // Process the first text node
    let text = textNode.textContent || ''
    const words = ['Claude', "Code's", 'creator', 'Boris', 'Cherny']

    words.forEach(word => {
      const regex = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi')
      text = text.replace(regex, match => {
        return `<u class="enx-word enx-${word.toLowerCase()}" data-word="${match}">${match}</u>`
      })
    })

    // Replace with fragment
    const tempContainer = document.createElement('span')
    tempContainer.innerHTML = text

    const fragment = document.createDocumentFragment()
    while (tempContainer.firstChild) {
      fragment.appendChild(tempContainer.firstChild)
    }

    textNode.parentNode!.replaceChild(fragment, textNode)

    // Get the full paragraph text
    const p = container.querySelector('p')!
    const fullText = p.textContent || ''

    console.log('Full paragraph text:', fullText)

    // Verify: Should have space between "Cherny," and "described"
    expect(fullText).toMatch(/Cherny,\s+described/)
    // Normalize whitespace for comparison (multiple spaces/newlines become single space)
    const normalizedText = fullText.replace(/\s+/g, ' ').trim()
    expect(normalizedText).toContain('Claude Code\'s creator, Boris Cherny, described')
  })

  it('should preserve trailing spaces in text nodes', () => {
    // Text node with trailing space (common in HTML)
    const textWithTrailingSpace = "Claude Code's creator, Boris Cherny, " // Note the trailing space

    let text = textWithTrailingSpace
    const words = ['Claude', "Code's", 'creator', 'Boris', 'Cherny']

    words.forEach(word => {
      const regex = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi')
      text = text.replace(regex, match => {
        return `<u class="enx-word">${match}</u>`
      })
    })

    console.log('Replaced text:', JSON.stringify(text))

    // Parse with innerHTML
    const tempContainer = document.createElement('span')
    tempContainer.innerHTML = text

    const renderedText = tempContainer.textContent || ''

    console.log('Original:', JSON.stringify(textWithTrailingSpace))
    console.log('Rendered:', JSON.stringify(renderedText))

    // BUG: innerHTML might collapse or remove trailing spaces
    expect(renderedText).toBe(textWithTrailingSpace)
    expect(renderedText.endsWith(', ')).toBe(true) // Should have trailing space
  })

  it('should preserve spaces in innerHTML when setting', () => {
    const htmlWithSpaces = '<u>Claude</u> <u>Code\'s</u> <u>creator</u>, <u>Boris</u> <u>Cherny</u>, '

    const container = document.createElement('div')
    container.innerHTML = htmlWithSpaces

    const retrievedHtml = container.innerHTML
    console.log('Set HTML:', htmlWithSpaces)
    console.log('Got HTML:', retrievedHtml)

    // Verify: innerHTML should preserve spaces between tags
    expect(retrievedHtml).toContain('</u> <u') // Space between tags
    expect(retrievedHtml).toContain('</u>, <u') // Space and comma

    // Verify: textContent should have spaces
    expect(container.textContent).toContain('Claude Code')
    expect(container.textContent).toContain('Boris Cherny')
  })
})
