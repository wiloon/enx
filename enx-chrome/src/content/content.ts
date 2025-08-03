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
    // If word is already acquainted, known word type, or not in database, don't highlight
    if (wordData.AlreadyAcquainted === 1 || wordData.WordType === 1 || wordData.LoadCount === 0) {
      return '#FFFFFF'
    }

    const loadCount = wordData.LoadCount || 0
    const normalizedCount = Math.min(loadCount, 30) / 30
    const hue = Math.round(300 * normalizedCount)

    return `hsl(${hue}, 100%, 40%)`
  }

  static renderWithHighlights(originalHtml: string, wordDict: Record<string, WordData>): string {
    console.log('Starting renderWithHighlights with', Object.keys(wordDict).length, 'words')

    // Create a temporary DOM element to work with
    const tempDiv = document.createElement('div')
    tempDiv.innerHTML = originalHtml

    let totalReplacements = 0

    // Process each word in the dictionary
    Object.keys(wordDict).forEach(word => {
      const wordData = wordDict[word]
      const colorCode = this.getColorCode(wordData)

      // Find all text nodes that contain this word, excluding those inside links
      const walker = document.createTreeWalker(
        tempDiv,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode: (node) => {
            // Check if the text node is inside a link
            let parent = node.parentNode
            while (parent && parent !== tempDiv) {
              if (parent.nodeName.toLowerCase() === 'a') {
                return NodeFilter.FILTER_REJECT
              }
              parent = parent.parentNode
            }
            return NodeFilter.FILTER_ACCEPT
          }
        }
      )

      const textNodes: Text[] = []
      let node
      while (node = walker.nextNode()) {
        textNodes.push(node as Text)
      }

      const wordRegex = new RegExp(
        `\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
        'gi'
      )

      textNodes.forEach(textNode => {
        const text = textNode.textContent || ''
        if (wordRegex.test(text)) {
          const highlightedText = text.replace(wordRegex, (match) => {
            totalReplacements++
            // add console log for debugging, print word and colorCode
            console.log('Highlighting word:', match, 'with color:', colorCode)
            return `<u class="enx-word enx-${word.toLowerCase()}" data-word="${match}" style="text-decoration: ${colorCode} underline; text-decoration-thickness: 2px; cursor: pointer;">${match}</u>`
          })

          // Create a temporary container and replace the text node
          const tempContainer = document.createElement('span')
          tempContainer.innerHTML = highlightedText

          // Replace the text node with the highlighted content
          while (tempContainer.firstChild) {
            textNode.parentNode!.insertBefore(tempContainer.firstChild, textNode)
          }
          textNode.parentNode!.removeChild(textNode)
        }
      })
    })

    console.log('Total word replacements made:', totalReplacements)
    return tempDiv.innerHTML
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

  // Position popup to avoid covering the sentence context
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const scrollX = window.scrollX
  const scrollY = window.scrollY
  const popupWidth = 320
  const popupHeight = 200 // Approximate popup height
  const margin = 15
  const lineHeight = 24 // Approximate line height in articles
  const contextLines = 2 // Lines above to keep visible

  // Calculate safe zones to avoid covering
  const clickX = event.clientX + scrollX
  const clickY = event.clientY + scrollY
  
  // Define exclusion zones (areas to avoid covering)
  const sentenceExclusionHeight = lineHeight * (contextLines + 1) // Height above to keep clear
  
  // X-coordinate: Center popup directly above the clicked word
  let x = clickX - (popupWidth / 2)
  
  // Y-coordinate: Keep the existing vertical positioning logic
  let y = Math.max(
    clickY - sentenceExclusionHeight - popupHeight - margin, // Above the context
    scrollY + margin // But not above viewport
  )
  
  // If positioning above would put it too high, place below
  if (y < scrollY + margin) {
    y = clickY + margin * 2 // Below the word with extra margin
  }

  // Final boundary checks
  x = Math.max(scrollX + margin, Math.min(x, scrollX + viewportWidth - popupWidth - margin))
  y = Math.max(scrollY + margin, Math.min(y, scrollY + viewportHeight - popupHeight - margin))

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
    console.log('Fetching translation for word:', word)
    const response = await sendToBackground({
      type: 'getOneWord',
      word: word.trim()
    })

    console.log('Translation response:', response)

    if (response.success && response.ecp) {
      updatePopupContent(popup, response.ecp)
      wordCache[word.toLowerCase()] = response.ecp
      // Update word highlighting in case AlreadyAcquainted status changed
      updateWordHighlighting(word, response.ecp)
    } else if (response.sessionExpired) {
      console.log('Session expired, showing session expired message')
      hideWordPopup()
      showSessionExpiredMessage()
    } else {
      const errorMessage = response.error || 'Translation service unavailable'
      console.error('Translation failed:', errorMessage)
      updatePopupError(popup, errorMessage)
    }
  } catch (error) {
    console.error('Error fetching word translation:', error)
    updatePopupError(popup, 'Connection failed. Please check your internet connection.')
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
        // Get current user from Chrome storage
        const result = await chrome.storage.local.get(['user', 'enx-user'])
        console.log('Storage result:', result)
        console.log('User data from storage:', result.user)
        console.log('ENX User data from storage:', result['enx-user'])

        const userId = result.user?.id || result.user?.userId || result['enx-user']?.id
        console.log('Extracted user ID:', userId)

        if (!userId) {
          console.error('No user ID found, user may not be logged in')
          alert('Please login first')
          return
        }

        console.log('Marking word as acquainted:', wordData.English, 'for user:', userId)

        const response = await sendToBackground({
          type: 'markAcquainted',
          word: wordData.English,
          userId: userId
        })

        console.log('Mark acquainted response:', response)

        if (response.success) {
          hideWordPopup()
          // Update word highlighting
          updateWordHighlighting(wordData.English, response.ecp || wordData)
          console.log('Word marked as acquainted successfully')
        } else if (response.sessionExpired) {
          console.log('Session expired while marking word')
          hideWordPopup()
          showSessionExpiredMessage()
        } else {
          console.error('Failed to mark word as acquainted:', response.error)
          alert('Failed to mark word as known: ' + (response.error || 'Unknown error'))
        }
      } catch (error) {
        console.error('Error marking word:', error)
        alert('Error marking word as known')
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

// Show session expired message
const showSessionExpiredMessage = () => {
  // Remove any existing session message
  const existingMessage = document.getElementById('enx-session-expired')
  if (existingMessage) {
    existingMessage.remove()
  }

  // Create session expired notification
  const notification = document.createElement('div')
  notification.id = 'enx-session-expired'
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: #ff5722;
    color: white;
    padding: 16px 20px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    z-index: 10001;
    max-width: 320px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    line-height: 1.4;
    animation: slideIn 0.3s ease-out;
  `

  notification.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: flex-start;">
      <div>
        <div style="font-weight: bold; margin-bottom: 4px;">Session Expired</div>
        <div style="font-size: 13px; opacity: 0.9;">Please click the ENX extension icon to login again.</div>
      </div>
      <button id="enx-close-session-msg" style="background: none; border: none; color: white; font-size: 18px; cursor: pointer; padding: 0; margin-left: 12px;">×</button>
    </div>
  `

  // Add CSS animation
  const style = document.createElement('style')
  style.textContent = `
    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
  `
  document.head.appendChild(style)

  document.body.appendChild(notification)

  // Add close button event
  const closeBtn = notification.querySelector('#enx-close-session-msg')
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      notification.remove()
    })
  }

  // Auto remove after 10 seconds
  setTimeout(() => {
    if (notification.parentNode) {
      notification.remove()
    }
  }, 10000)
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
          console.log('Raw response.wordProperties:', response.wordProperties)

          // Check if wordProperties is wrapped in a 'data' field
          const actualWordData = response.wordProperties.data || response.wordProperties
          console.log('Actual word data to process:', actualWordData)
          console.log('Word data keys:', Object.keys(actualWordData))

          Object.assign(wordCache, actualWordData)
          console.log(`Processed ${Object.keys(actualWordData).length} words in chunk`)
          console.log('Current word cache size:', Object.keys(wordCache).length)
        } else if (response.sessionExpired) {
          console.log('Session expired during word processing')
          showSessionExpiredMessage()
          break // Stop processing if session expired
        }
      } catch (error) {
        console.error('Error processing word chunk:', error)
      }
    }

    // Apply highlighting to the article
    if (Object.keys(wordCache).length > 0) {
      console.log('Applying highlighting for', Object.keys(wordCache).length, 'words')
      console.log('Sample words from cache:', Object.keys(wordCache).slice(0, 5))
      console.log('Sample word data:', Object.values(wordCache)[0])

      const originalHtml = articleNode.innerHTML
      const highlightedHtml = ContentWordProcessor.renderWithHighlights(originalHtml, wordCache)

      console.log('Original HTML length:', originalHtml.length)
      console.log('Highlighted HTML length:', highlightedHtml.length)
      console.log('HTML changed:', originalHtml !== highlightedHtml)

      articleNode.innerHTML = highlightedHtml

      // Add click listeners to highlighted words
      addWordClickListeners(articleNode)
      console.log('Word highlighting applied.')
      
      // Add processing complete indicator
      addProcessingCompleteIndicator(articleNode)
    } else {
      console.log('No words in cache, skipping highlighting')
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

// Add processing complete indicator to the article
const addProcessingCompleteIndicator = (articleNode: Element) => {
  // Remove any existing indicator
  const existingIndicator = document.getElementById('enx-processing-complete')
  if (existingIndicator) {
    existingIndicator.remove()
  }

  // Create the indicator element
  const indicator = document.createElement('div')
  indicator.id = 'enx-processing-complete'
  indicator.style.cssText = `
    position: relative;
    display: inline-flex;
    align-items: center;
    background: linear-gradient(90deg, #4CAF50, #45a049);
    color: white;
    padding: 8px 12px;
    border-radius: 20px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 12px;
    font-weight: 500;
    margin-bottom: 16px;
    box-shadow: 0 2px 8px rgba(76, 175, 80, 0.3);
    animation: slideInFromTop 0.5s ease-out;
    z-index: 1000;
  `

  indicator.innerHTML = `
    <svg style="width: 14px; height: 14px; margin-right: 6px;" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    Article processed • Click words for translation
  `

  // Add CSS animation
  const style = document.createElement('style')
  style.textContent = `
    @keyframes slideInFromTop {
      from { 
        transform: translateY(-20px); 
        opacity: 0; 
      }
      to { 
        transform: translateY(0); 
        opacity: 1; 
      }
    }
  `
  if (!document.head.querySelector('style[data-enx-animations]')) {
    style.setAttribute('data-enx-animations', 'true')
    document.head.appendChild(style)
  }

  // Insert at the beginning of the article
  articleNode.insertBefore(indicator, articleNode.firstChild)
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
const enableEnx = async () => {
  if (isEnxEnabled) return

  console.log('Enabling ENX functionality')
  isEnxEnabled = true

  // Add mouseup listener for text selection
  document.addEventListener('mouseup', handleTextSelection)

  // Process article content and wait for completion
  await processArticleContent()
  
  return true
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

  // Remove processing complete indicator
  const indicator = document.getElementById('enx-processing-complete')
  if (indicator) {
    indicator.remove()
  }

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
      enableEnx().then((result) => {
        sendResponse({ success: true, completed: result })
      }).catch((error) => {
        console.error('Error enabling ENX:', error)
        sendResponse({ success: false, error: error.message })
      })
      return true // Keep message channel open for async response

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

    case 'sessionExpired':
      console.log('Session expired notification received')
      showSessionExpiredMessage()
      // Disable ENX functionality if it's currently enabled
      if (isEnxEnabled) {
        disableEnx()
      }
      sendResponse({ success: true })
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
