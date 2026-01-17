/**
 * Test suite for real-world InfoQ HTML structure
 * 
 * Based on actual console logs from InfoQ article page
 */

describe('Real-world InfoQ HTML Structure', () => {
  it('should handle InfoQ article HTML structure', () => {
    // Recreate the actual HTML structure from InfoQ
    const container = document.createElement('div')
    container.innerHTML = `
      <p>
        <span style="box-sizing: border-box; margin: 0px; padding: 0px;">Claude Code's creator, Boris Cherny, </span>
        <a href="#">described how he uses Claude Code at Anthropic</a>
        <span>, highlighting practices such as running parallel instances, sharing learnings, automating prompting, and rigorously verifying results to compound productivity over time.</span>
      </p>
    `

    // Process first text node (like in the real code)
    const span = container.querySelector('span')!
    const textNode = span.firstChild as Text
    const originalText = textNode.textContent || ''

    console.log('Original text node:', JSON.stringify(originalText))
    console.log('Next sibling:', textNode.nextSibling?.nodeName)

    // Simulate word replacement
    let text = originalText
    const words = ['Claude', "Code's", 'creator', 'Boris', 'Cherny']

    words.forEach(word => {
      const regex = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi')
      text = text.replace(regex, match => {
        return `<u class="enx-word enx-${word.toLowerCase()}" data-word="${match}" style="text-decoration: #FFFFFF underline; text-decoration-thickness: 1px;">${match}</u>`
      })
    })

    console.log('Replaced text:', text.substring(0, 200))

    // Parse HTML and create fragment
    const tempContainer = document.createElement('span')
    tempContainer.innerHTML = text

    console.log('TempContainer children:', tempContainer.childNodes.length)
    Array.from(tempContainer.childNodes).forEach((child, i) => {
      console.log(`  Child ${i}:`, child.nodeName, JSON.stringify(child.textContent?.substring(0, 30)))
    })

    const fragment = document.createDocumentFragment()
    while (tempContainer.firstChild) {
      fragment.appendChild(tempContainer.firstChild)
    }

    // Replace the text node
    span.replaceChild(fragment, textNode)

    // Check the full paragraph text
    const p = container.querySelector('p')!
    const fullText = p.textContent || ''

    console.log('Full paragraph text:', fullText)
    console.log('Full paragraph visible text (trimmed):', fullText.trim().replace(/\s+/g, ' '))

    // The critical check: space between "Cherny," and "described"
    const visibleText = fullText.trim().replace(/\s+/g, ' ')
    
    // Should have space between the span and the link
    expect(visibleText).toMatch(/Cherny,\s+described/)
    expect(visibleText).toContain('Boris Cherny, described')
    
    // Should NOT be "Cherny,described" (without space)
    expect(visibleText).not.toContain('Cherny,described')
  })

  it('should preserve space at the end of text node when next sibling is element', () => {
    // This tests the specific case where:
    // <span>text with trailing space </span><a>link</a>
    const container = document.createElement('div')
    container.innerHTML = '<span>Hello </span><a>World</a>'

    const span = container.querySelector('span')!
    const textNode = span.firstChild as Text
    
    // Replace "Hello" with highlighted version
    let text = textNode.textContent || ''
    text = text.replace(/Hello/g, '<u class="enx-word">Hello</u>')

    // Parse and replace
    const tempContainer = document.createElement('span')
    tempContainer.innerHTML = text

    const fragment = document.createDocumentFragment()
    while (tempContainer.firstChild) {
      fragment.appendChild(tempContainer.firstChild)
    }

    span.replaceChild(fragment, textNode)

    // Check: Should be "Hello World" not "HelloWorld"
    const fullText = container.textContent || ''
    console.log('Result:', JSON.stringify(fullText))
    
    expect(fullText).toBe('Hello World')
    expect(fullText).not.toBe('HelloWorld')
  })

  it('should debug innerHTML normalization', () => {
    // Test if innerHTML normalizes whitespace
    const testCases = [
      '<u>Hello</u> <u>World</u>',
      '<u>Hello</u> <u>World</u> ',  // trailing space
      ' <u>Hello</u> <u>World</u>',  // leading space
      '<u>Hello</u>  <u>World</u>', // double space
    ]

    testCases.forEach(html => {
      const container = document.createElement('div')
      container.innerHTML = html
      const retrieved = container.innerHTML
      
      console.log('Set:', JSON.stringify(html))
      console.log('Got:', JSON.stringify(retrieved))
      console.log('Text:', JSON.stringify(container.textContent))
      console.log('---')
    })
  })
})
