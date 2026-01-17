/**
 * Tests for flex container fix that preserves whitespace
 * 
 * Problem: When parent elements use display: inline-flex or -webkit-inline-box,
 * text nodes (spaces) between child elements are ignored by the flex layout.
 * 
 * Solution: Force parent elements containing <u.enx-word> elements to use
 * display: inline instead of flex layouts.
 * 
 * @jest-environment jsdom
 */

describe('Flex Container Fix', () => {
  let container: HTMLElement

  beforeEach(() => {
    document.body.innerHTML = ''
    container = document.body
  })

  /**
   * Simulates the flex container fix logic from content.ts
   */
  function fixFlexContainers(root: HTMLElement) {
    const allSpans = root.querySelectorAll('span')
    let fixedCount = 0
    
    allSpans.forEach(span => {
      const hasUChildren = span.querySelector('u.enx-word')
      if (hasUChildren) {
        const computedStyle = window.getComputedStyle(span)
        if (computedStyle.display === 'inline-flex' || computedStyle.display === '-webkit-inline-box') {
          (span as HTMLElement).style.setProperty('display', 'inline', 'important')
          fixedCount++
        }
      }
    })
    
    return fixedCount
  }

  test('should detect and fix inline-flex parent containing <u> elements', () => {
    // Setup: Create a span with inline-flex that contains highlighted words
    container.innerHTML = `
      <p>
        <span style="display: inline-flex;">
          <u class="enx-word" data-word="Claude" style="display: inline !important;">Claude</u>
          <u class="enx-word" data-word="Code" style="display: inline !important;">Code</u>
        </span>
      </p>
    `

    const span = container.querySelector('span') as HTMLElement
    const initialDisplay = window.getComputedStyle(span).display
    expect(initialDisplay).toBe('inline-flex')

    // Act: Apply fix
    const fixedCount = fixFlexContainers(container)

    // Assert: Span should now be inline
    expect(fixedCount).toBe(1)
    expect(span.style.display).toBe('inline')
    expect(span.style.getPropertyPriority('display')).toBe('important')
  })

  test('should fix -webkit-inline-box parent containing <u> elements', () => {
    container.innerHTML = `
      <span style="display: -webkit-inline-box;">
        <u class="enx-word">word</u>
      </span>
    `

    const span = container.querySelector('span') as HTMLElement
    fixFlexContainers(container)

    expect(span.style.display).toBe('inline')
    expect(span.style.getPropertyPriority('display')).toBe('important')
  })

  test('should preserve whitespace text nodes after fixing flex container', () => {
    // Real-world InfoQ structure
    container.innerHTML = `
      <p>
        <span style="display: inline-flex;">
          <u class="enx-word">Claude</u> <u class="enx-word">Code's</u> <u class="enx-word">creator</u>
        </span>
      </p>
    `

    const span = container.querySelector('span') as HTMLElement
    
    // Verify text nodes exist before fix
    const childNodes = span.childNodes
    expect(childNodes.length).toBeGreaterThan(3) // Should have both U elements and text nodes
    
    // Count text nodes with spaces
    let spaceNodes = 0
    childNodes.forEach(node => {
      if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim() === '') {
        spaceNodes++
      }
    })
    expect(spaceNodes).toBeGreaterThan(0)

    // Apply fix
    fixFlexContainers(container)

    // Verify display is now inline
    expect(span.style.display).toBe('inline')
    
    // Verify text nodes still exist
    const afterNodes = span.childNodes
    expect(afterNodes.length).toBe(childNodes.length)
  })

  test('should NOT fix span without <u.enx-word> children', () => {
    container.innerHTML = `
      <span style="display: inline-flex;">
        <strong>Not a word</strong>
      </span>
    `

    const fixedCount = fixFlexContainers(container)
    const span = container.querySelector('span') as HTMLElement

    expect(fixedCount).toBe(0)
    expect(span.style.display).not.toBe('inline')
  })

  test('should NOT fix span with regular display value', () => {
    container.innerHTML = `
      <span style="display: inline;">
        <u class="enx-word">word</u>
      </span>
    `

    const span = container.querySelector('span') as HTMLElement
    const initialDisplay = span.style.display
    
    fixFlexContainers(container)

    // Should not add !important to already inline spans
    expect(span.style.getPropertyPriority('display')).not.toBe('important')
  })

  test('should fix multiple flex containers in same document', () => {
    container.innerHTML = `
      <div>
        <span style="display: inline-flex;"><u class="enx-word">word1</u></span>
        <span style="display: inline-flex;"><u class="enx-word">word2</u></span>
        <span style="display: -webkit-inline-box;"><u class="enx-word">word3</u></span>
      </div>
    `

    const fixedCount = fixFlexContainers(container)
    expect(fixedCount).toBe(3)

    const spans = container.querySelectorAll('span')
    spans.forEach(span => {
      expect((span as HTMLElement).style.display).toBe('inline')
    })
  })

  test('should handle nested spans correctly', () => {
    container.innerHTML = `
      <span style="display: inline-flex;">
        <span style="display: inline-flex;">
          <u class="enx-word">nested</u>
        </span>
      </span>
    `

    const fixedCount = fixFlexContainers(container)
    
    // Both spans contain <u> elements (directly or indirectly), so both should be fixed
    expect(fixedCount).toBe(2)
    
    const outerSpan = container.querySelector('span') as HTMLElement
    const innerSpan = container.querySelector('span span') as HTMLElement
    
    expect(outerSpan.style.display).toBe('inline')
    expect(innerSpan.style.display).toBe('inline')
  })

  test('regression test: InfoQ article structure with flex containers', () => {
    // Exact structure from InfoQ that caused the bug
    container.innerHTML = `
      <p>
        <span style="box-sizing: border-box; margin: 0px; padding: 0px; display: inline-flex;">
          <u class="enx-word enx-claude" data-word="Claude" style="display: inline !important; text-decoration: #FFFFFF underline; text-decoration-thickness: 1px;">Claude</u>
          <u class="enx-word enx-code's" data-word="Code's" style="display: inline !important; text-decoration: #FFFFFF underline; text-decoration-thickness: 1px;">Code's</u>
          <u class="enx-word enx-creator" data-word="creator" style="display: inline !important; text-decoration: #FFFFFF underline; text-decoration-thickness: 1px;">creator</u>, 
          <a href="#">Boris Cherny</a>
        </span>
      </p>
    `

    const span = container.querySelector('span') as HTMLElement
    
    // Before fix: inline-flex causes spaces to be ignored
    const beforeDisplay = window.getComputedStyle(span).display
    expect(beforeDisplay).toBe('inline-flex')

    // Apply fix
    const fixedCount = fixFlexContainers(container)
    expect(fixedCount).toBe(1)

    // After fix: display is inline, spaces are preserved
    expect(span.style.display).toBe('inline')
    expect(span.style.getPropertyPriority('display')).toBe('important')

    // Verify text content includes spaces
    const text = span.textContent || ''
    expect(text).toContain('Claude')
    expect(text).toContain("Code's")
    expect(text).toContain('creator')
    
    // Verify spaces exist in the text
    expect(text).toMatch(/Claude\s+Code's\s+creator/)
  })
})
