// ENX Content Script for word identification and translation
// Note: Sentry initialization is skipped to avoid import issues in content script context

import { WordData, ContentMessage, BackgroundResponse } from '../types'

console.log('ENX Content script loaded')

// State management for content script
let isEnxEnabled = false
let currentPopup: HTMLElement | null = null
let wordCache: Record<string, WordData> = {}
let isProcessing = false

// Word processing utilities (inline to avoid import issues)
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
        return word.length > 0 && 
               word.length <= 50 && 
               !/^\d+$/.test(word) &&
               /[a-zA-Z]/.test(word)
      })
      .map(word => word.toLowerCase())
  }

  static getColorCode(wordData: WordData): string {
    if (wordData.AlreadyAcquainted === 1 || wordData.WordType === 1) {
      return '#FFFFFF'
    }

    const loadCount = wordData.LoadCount || 0
    const normalizedCount = Math.min(loadCount, 30) / 30
    const hue = Math.round(300 * normalizedCount)
    
    return `hsl(${hue}, 100%, 40%)`
  }

  static renderWithHighlights(originalHtml: string, wordDict: Record<string, WordData>): string {
    let processedHtml = originalHtml

    Object.keys(wordDict).forEach(word => {
      const wordData = wordDict[word]
      const colorCode = this.getColorCode(wordData)
      
      const wordRegex = new RegExp(
        `\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
        'gi'
      )

      processedHtml = processedHtml.replace(wordRegex, (match) => {
        return `<u class="enx-word enx-${word}" data-word="${match}" style="margin-left: 2px; margin-right: 2px; text-decoration: ${colorCode} underline; text-decoration-thickness: 2px; cursor: pointer;">${match}</u>`
      })
    })

    return processedHtml
  }

  static getArticleNode(): Element | null {
    const selectors = [
      '.Article',           // BBC
      '.article__data',     // InfoQ
      '.post-content',      // Blog posts
      '#EMAIL_CONTAINER',   // NY Times
      '.text',              // TingRoom
      'article',            // Semantic HTML5
      '.content',
      '.entry-content',
      '.post-body',
    ]

    for (const selector of selectors) {
      const element = document.querySelector(selector)
      if (element && element.textContent && element.textContent.trim().length > 100) {
        return element
      }
    }

    // Fallback: find largest text container
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
}

// Send message to background script
const sendToBackground = (message: ContentMessage): Promise<BackgroundResponse> => {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      resolve(response || { success: false, error: 'No response' })
    })
  })
}

// Create and show word popup
const showWordPopup = async (word: string, event: MouseEvent) => {
  if (!word || word.trim() === '') return

  console.log('Showing popup for word:', word)

  // Remove existing popup
  hideWordPopup()

  // Create popup container
  const popup = document.createElement('div')
  popup.id = 'enx-word-popup'
  popup.className = 'enx-popup'
  popup.style.cssText = `
    position: absolute;
    background: white;
    border: 1px solid #ccc;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    padding: 16px;
    z-index: 10000;
    max-width: 320px;
    min-width: 280px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    line-height: 1.4;
  `

  // Position popup
  const viewportWidth = window.innerWidth
  const scrollX = window.scrollX
  const scrollY = window.scrollY

  let x = event.clientX + scrollX
  let y = event.clientY + scrollY - 50

  // Adjust position to stay in viewport
  if (x + 320 > scrollX + viewportWidth) {
    x = scrollX + viewportWidth - 320 - 10
  }
  if (y < scrollY) {
    y = event.clientY + scrollY + 20
  }

  popup.style.left = `${x}px`
  popup.style.top = `${y}px`

  // Add loading content
  popup.innerHTML = `
    <div class="enx-popup-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
      <h3 style="margin: 0; font-size: 16px; font-weight: bold; color: #333;">${word}</h3>
      <button class="enx-close-btn" style="background: none; border: none; font-size: 18px; cursor: pointer; color: #999;">×</button>
    </div>
    <div class="enx-popup-content">
      <div style="color: #666; font-style: italic;">
        <span style="display: inline-block; animation: spin 1s linear infinite; margin-right: 8px;">⏳</span>
        Loading translation...
      </div>
    </div>
  `

  // Add CSS animation
  const style = document.createElement('style')
  style.textContent = `
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `
  document.head.appendChild(style)

  document.body.appendChild(popup)
  currentPopup = popup

  // Add close button event
  const closeBtn = popup.querySelector('.enx-close-btn')
  if (closeBtn) {
    closeBtn.addEventListener('click', hideWordPopup)
  }

  // Close on escape key
  const handleKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      hideWordPopup()
      document.removeEventListener('keydown', handleKeydown)
    }
  }
  document.addEventListener('keydown', handleKeydown)

  // Fetch word translation
  try {
    const response = await sendToBackground({
      type: 'getOneWord',
      word: word.trim()
    })

    if (response.success && response.ecp) {
      updatePopupContent(popup, response.ecp)
      wordCache[word.toLowerCase()] = response.ecp
    } else {
      updatePopupError(popup, response.error || 'Translation failed')
    }
  } catch (error) {
    console.error('Error fetching word translation:', error)
    updatePopupError(popup, 'Network error')
  }
}

// Update popup with word data
const updatePopupContent = (popup: HTMLElement, wordData: WordData) => {
  const content = popup.querySelector('.enx-popup-content')
  if (!content) return

  const youdaoUrl = `https://www.youdao.com/result?word=${encodeURIComponent(wordData.English)}&lang=en`

  content.innerHTML = `
    ${wordData.Pronunciation ? `<div style="margin-bottom: 8px; color: #666; font-weight: 500;">${wordData.Pronunciation}</div>` : ''}
    ${wordData.Chinese ? `<div style="margin-bottom: 12px; color: #333;">${wordData.Chinese}</div>` : ''}
    ${wordData.LoadCount !== undefined ? `<div style="margin-bottom: 12px; font-size: 12px; color: #888;">Query Count: ${wordData.LoadCount}</div>` : ''}
    ${wordData.AlreadyAcquainted === 1 ? `<div style="color: #4CAF50; font-size: 12px; margin-bottom: 12px;">✓ Already acquainted</div>` : ''}
    <div style="display: flex; justify-content: space-between; align-items: center; padding-top: 12px; border-top: 1px solid #eee;">
      <a href="${youdaoUrl}" target="_blank" style="color: #1976d2; text-decoration: none; font-size: 12px;">📚 Youdao</a>
      ${wordData.AlreadyAcquainted !== 1 ? `<button class="enx-mark-btn" style="background: #4CAF50; color: white; border: none; padding: 4px 8px; border-radius: 4px; font-size: 12px; cursor: pointer;">✓ Mark Known</button>` : ''}
    </div>
  `

  // Add mark button event
  const markBtn = content.querySelector('.enx-mark-btn')
  if (markBtn) {
    markBtn.addEventListener('click', async () => {
      try {
        const response = await sendToBackground({
          type: 'markAcquainted',
          word: wordData.English,
          userId: 1 // TODO: Get from stored user data
        })
        
        if (response.success) {
          hideWordPopup()
          // Update word highlighting
          updateWordHighlighting(wordData.English, response.ecp || wordData)
        }
      } catch (error) {
        console.error('Error marking word:', error)
      }
    })
  }
}

// Update popup with error
const updatePopupError = (popup: HTMLElement, error: string) => {
  const content = popup.querySelector('.enx-popup-content')
  if (!content) return

  content.innerHTML = `
    <div style="color: #f44336; padding: 8px; background: #ffebee; border: 1px solid #ffcdd2; border-radius: 4px;">
      ${error}
    </div>
  `
}

// Hide word popup
const hideWordPopup = () => {
  if (currentPopup) {
    currentPopup.remove()
    currentPopup = null
  }
}

// Update word highlighting color
const updateWordHighlighting = (word: string, wordData: WordData) => {
  const elements = document.querySelectorAll(`.enx-${word.toLowerCase()}`)
  const colorCode = ContentWordProcessor.getColorCode(wordData)
  
  elements.forEach(element => {
    if (element instanceof HTMLElement) {
      element.style.textDecoration = `${colorCode} underline`
    }
  })
}

// Process article content and add word highlighting
const processArticleContent = async () => {
  if (isProcessing) return
  isProcessing = true

  try {
    console.log('Processing article content...')
    
    const articleNode = ContentWordProcessor.getArticleNode()
    if (!articleNode) {
      console.log('No article node found')
      return
    }

    console.log('Article node found:', articleNode)

    // Get text content and extract words
    const textContent = articleNode.textContent || ''
    const words = ContentWordProcessor.extractWords(textContent)
    
    if (words.length === 0) {
      console.log('No words found to process')
      return
    }

    console.log(`Found ${words.length} words to process`)

    // Process words in chunks
    const chunkSize = 200 // Process in smaller chunks for better performance
    for (let i = 0; i < words.length; i += chunkSize) {
      const chunk = words.slice(i, i + chunkSize)
      const paragraph = chunk.join(' ')

      try {
        const response = await sendToBackground({
          type: 'getWords',
          paragraph
        })

        if (response.success && response.wordProperties) {
          Object.assign(wordCache, response.wordProperties)
          console.log(`Processed ${Object.keys(response.wordProperties).length} words in chunk`)
        }
      } catch (error) {
        console.error('Error processing word chunk:', error)
      }
    }

    // Apply highlighting to the article
    if (Object.keys(wordCache).length > 0) {
      const originalHtml = articleNode.innerHTML
      const highlightedHtml = ContentWordProcessor.renderWithHighlights(originalHtml, wordCache)
      articleNode.innerHTML = highlightedHtml

      // Add click listeners to highlighted words
      addWordClickListeners(articleNode)
      console.log('Word highlighting applied')
    }

  } catch (error) {
    console.error('Error processing article:', error)
  } finally {
    isProcessing = false
  }
}

// Add click listeners to highlighted words
const addWordClickListeners = (container: Element) => {
  const wordElements = container.querySelectorAll('.enx-word')
  
  wordElements.forEach(element => {
    element.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      
      const word = (element as HTMLElement).dataset.word || element.textContent || ''
      if (word) {
        showWordPopup(word, event as MouseEvent)
      }
    })
  })
}

// Handle text selection for multi-word translation
const handleTextSelection = (event: MouseEvent) => {
  const selection = window.getSelection()
  const selectedText = selection?.toString().trim()
  
  if (selectedText && selectedText.split(' ').length <= 5) {
    // Handle multi-word selection
    showWordPopup(selectedText, event)
  }
}

// Enable ENX functionality
const enableEnx = () => {
  if (isEnxEnabled) return
  
  console.log('Enabling ENX functionality')
  isEnxEnabled = true
  
  // Add mouseup listener for text selection
  document.addEventListener('mouseup', handleTextSelection)
  
  // Process article content
  processArticleContent()
}

// Disable ENX functionality
const disableEnx = () => {
  if (!isEnxEnabled) return
  
  console.log('Disabling ENX functionality')
  isEnxEnabled = false
  
  // Remove event listeners
  document.removeEventListener('mouseup', handleTextSelection)
  
  // Hide popup
  hideWordPopup()
  
  // Remove word highlighting
  const wordElements = document.querySelectorAll('.enx-word')
  wordElements.forEach(element => {
    const textContent = element.textContent || ''
    element.replaceWith(document.createTextNode(textContent))
  })
}

// Listen for messages from popup or background
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  console.log('Content script received message:', request)
  
  switch (request.action) {
    case 'enxRun':
      enableEnx()
      sendResponse({ success: true })
      break
      
    case 'enxStop':
      disableEnx()
      sendResponse({ success: true })
      break
      
    case 'getPageInfo':
      sendResponse({
        title: document.title,
        url: window.location.href,
        isEnxEnabled
      })
      break
      
    default:
      sendResponse({ success: false, error: 'Unknown action' })
  }
  
  return true
})

// Add extension indicator
const indicator = document.createElement('div')
indicator.id = 'enx-extension-indicator'
indicator.title = 'ENX Extension Active'
indicator.style.cssText = `
  position: fixed;
  top: 10px;
  right: 10px;
  width: 12px;
  height: 12px;
  background: #4CAF50;
  border: 2px solid white;
  border-radius: 50%;
  z-index: 9999;
  pointer-events: none;
  box-shadow: 0 2px 4px rgba(0,0,0,0.2);
`
document.body.appendChild(indicator)

// Clean up on page unload
window.addEventListener('beforeunload', () => {
  indicator.remove()
  hideWordPopup()
})

console.log('ENX Content script ready')