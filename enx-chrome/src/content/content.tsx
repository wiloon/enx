// ENX Content Script for word identification and translation
// Note: Sentry initialization is skipped to avoid import issues in content script context

import { createRoot, type Root } from 'react-dom/client'
import { Provider } from 'jotai'
import { WordProcessor } from '@/lib/wordProcessor'
import { BackgroundResponse, ContentMessage, WordData } from '../types'
import { contentScriptStore } from './contentAtoms'
import { currentWordAtom, isTranslatingAtom, errorAtom } from '@/store/atoms'
import WordPopup from '@/components/WordPopup'
import tailwindCss from '@/index.css?inline'

console.log('ENX Content script loaded')

// State management for content script
let isEnxEnabled = false
let currentPopup: HTMLElement | null = null
let currentRoot: Root | null = null
let wordCache: Record<string, WordData> = {}
let isProcessing = false
let popupEventCleanup: (() => void) | null = null

// Send message to background script
const sendToBackground = (
  message: ContentMessage
): Promise<BackgroundResponse> => {
  return new Promise(resolve => {
    chrome.runtime.sendMessage(message, response => {
      resolve(response || { success: false, error: 'No response' })
    })
  })
}

// Extract US phonetic from a pronunciation string.
// Some entries (scraped before the API migration) store both UK and US
// phonetics concatenated, e.g. "[dɪˈskrɪmɪnətəri][dɪˈskrɪmɪnətə:ri]".
// In that case the second bracket pair is the American English pronunciation.
export const extractUSPhonetic = (pronunciation: string): string => {
  const matches = pronunciation.match(/\[[^\]]+\]/g)
  if (matches && matches.length >= 2) {
    return matches[matches.length - 1]
  }
  return pronunciation
}

// Create and show word popup using Popover API + CSS Anchor Positioning
// Requires Chrome 125+ for full support (CSS Anchor Positioning)
const showWordPopup = async (word: string, event: MouseEvent) => {
  if (!word || word.trim() === '') return

  console.log('Showing popup for word:', word)

  // Remove existing popup
  hideWordPopup()

  // 1. Mark the clicked element as anchor
  const anchor = event.target as HTMLElement
  const anchorId = `enx-word-anchor-${Date.now()}`
  anchor.style.setProperty('anchor-name', `--${anchorId}`)

  // 2. Create Popover popup
  const popup = document.createElement('div') as HTMLElement & { popover: string; showPopover: () => void; hidePopover: () => void }
  popup.popover = 'manual'  // Manual control
  popup.className = 'enx-word-popup'
  popup.id = 'enx-word-popup'

  // Vertical margin must clear a full line of the host page's own text,
  // not just a fixed pixel gap, or the popup's edge cuts into the line
  // adjacent to the anchor (see docs discussion on reading-flow positioning).
  const anchorStyle = window.getComputedStyle(anchor)
  let anchorLineHeight = parseFloat(anchorStyle.lineHeight)
  if (Number.isNaN(anchorLineHeight)) {
    anchorLineHeight = parseFloat(anchorStyle.fontSize) * 1.2
  }
  const verticalMargin = Math.ceil(anchorLineHeight)

  // 3. Apply CSS Anchor Positioning styles (host element stays in light DOM,
  // content rendering below is isolated inside its shadow root, see §2.1/§2.4)
  // position-area: top prioritizes showing above the clicked word, so the
  // popup covers already-read text rather than the upcoming sentence.
  popup.style.cssText = `
    position-anchor: --${anchorId};
    position-area: top;
    position-try-fallbacks: flip-block, flip-inline;
    min-width: 400px;
    max-width: 480px;
    max-height: 60vh;
    overflow-y: auto;
    margin-top: ${verticalMargin}px;
    margin-bottom: ${verticalMargin}px;
    margin-left: 16px;
    margin-right: 16px;
    padding: 0;
    border: none;
    background: transparent;
  `

  // 4. Render content via React, mounted inside a shadow root so Tailwind
  // classes can't leak into (or be overridden by) the host page's styles.
  const shadowRoot = popup.attachShadow({ mode: 'open' })
  const styleTag = document.createElement('style')
  styleTag.textContent = tailwindCss
  shadowRoot.appendChild(styleTag)

  const mountPoint = document.createElement('div')
  shadowRoot.appendChild(mountPoint)

  const root = createRoot(mountPoint)
  currentRoot = root

  const handleMarkAcquainted = async (englishWord: string) => {
    try {
      const response = await sendToBackground({
        type: 'markAcquainted',
        word: englishWord,
      })
      if (response.success) {
        const cached = wordCache[englishWord.toLowerCase()]
        const updated: WordData = cached
          ? { ...cached, AlreadyAcquainted: 1 }
          : {
              Key: englishWord,
              English: englishWord,
              Pronunciation: '',
              Chinese: '',
              LoadCount: 0,
              AlreadyAcquainted: 1,
              WordType: 0,
            }
        wordCache[englishWord.toLowerCase()] = updated
        contentScriptStore.set(currentWordAtom, updated)
        updateWordHighlighting(englishWord, updated)
        popup.hidePopover()
      }
    } catch (error) {
      console.error('Error marking word as acquainted:', error)
    }
  }

  root.render(
    <Provider store={contentScriptStore}>
      <WordPopup
        word={word}
        onClose={() => popup.hidePopover()}
        onMarkAcquainted={handleMarkAcquainted}
      />
    </Provider>
  )

  // 5. Show loading state
  contentScriptStore.set(currentWordAtom, null)
  contentScriptStore.set(isTranslatingAtom, true)
  contentScriptStore.set(errorAtom, null)

  // 6. Add to DOM and show Popover
  document.body.appendChild(popup)
  popup.showPopover()
  currentPopup = popup

  setupPopupEventHandlers(popup, anchor, root)

  // 7. Fetch word translation
  try {
    console.log('Fetching translation for word:', word)
    const response = await sendToBackground({
      type: 'getOneWord',
      word: word.trim(),
    })

    console.log('Translation response:', response)

    if (response.success && response.ecp) {
      // US phonetic extraction: some entries store both UK and US
      // pronunciations concatenated, see extractUSPhonetic() above.
      const wordData: WordData = {
        ...response.ecp,
        Pronunciation: response.ecp.Pronunciation
          ? extractUSPhonetic(response.ecp.Pronunciation)
          : response.ecp.Pronunciation,
      }

      contentScriptStore.set(currentWordAtom, wordData)
      contentScriptStore.set(isTranslatingAtom, false)

      wordCache[word.toLowerCase()] = wordData
      updateWordHighlighting(word, wordData)
    } else if (response.sessionExpired) {
      console.log('Session expired, showing session expired message')
      popup.hidePopover()
      showSessionExpiredMessage()
    } else {
      const errorMessage = response.error || 'Translation service unavailable'
      console.error('Translation failed:', errorMessage)
      contentScriptStore.set(errorAtom, errorMessage)
      contentScriptStore.set(isTranslatingAtom, false)
    }
  } catch (error) {
    console.error('Error fetching word translation:', error)
    contentScriptStore.set(
      errorAtom,
      'Connection failed. Please check your internet connection.'
    )
    contentScriptStore.set(isTranslatingAtom, false)
  }
}

// Setup event handlers for Popover popup
const setupPopupEventHandlers = (
  popup: HTMLElement & { hidePopover: () => void },
  anchor: HTMLElement,
  root: Root
) => {
  // Cleanup when popup is closed via hidePopover() (close button / ESC /
  // click-outside all route through hidePopover(), which reliably fires
  // 'toggle' -- confirmed via the §4.3 spike). This does NOT fire when a
  // popup is torn down by hideWordPopup()'s direct popup.remove() call (e.g.
  // switching to a new word while this one is still open) -- that path
  // unmounts explicitly instead, see hideWordPopup() below.
  popup.addEventListener('toggle', (e: Event) => {
    const toggleEvent = e as ToggleEvent
    if (toggleEvent.newState === 'closed') {
      if (currentRoot === root) {
        root.unmount()
        currentRoot = null
        console.debug('[enx] root unmounted')
      }
      popup.remove()
      anchor.style.removeProperty('anchor-name')  // Cleanup anchor
      if (currentPopup === popup) {
        currentPopup = null
      }
      if (popupEventCleanup) {
        popupEventCleanup()
        popupEventCleanup = null
      }
    }
  })

  // ESC key handler
  const handleKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      popup.hidePopover()
    }
  }

  // Click outside handler (optional, Popover API can handle this)
  const handleClickOutside = (e: MouseEvent) => {
    const target = e.target as HTMLElement
    if (!popup.contains(target) && !anchor.contains(target)) {
      popup.hidePopover()
    }
  }

  document.addEventListener('keydown', handleKeydown)
  document.addEventListener('click', handleClickOutside)

  popupEventCleanup = () => {
    document.removeEventListener('keydown', handleKeydown)
    document.removeEventListener('click', handleClickOutside)
  }
}

// Hide word popup
const hideWordPopup = () => {
  // Direct DOM removal does not reliably fire the popover's 'toggle' event
  // (confirmed via the §4.3 spike), so the React root is unmounted explicitly
  // here rather than relying solely on the toggle handler above.
  if (currentRoot) {
    currentRoot.unmount()
    currentRoot = null
    console.debug('[enx] root unmounted')
  }
  if (currentPopup) {
    currentPopup.remove()
    currentPopup = null
  }

  // Clean up event listeners
  if (popupEventCleanup) {
    popupEventCleanup()
    popupEventCleanup = null
  }
}

// Update word highlighting color
const updateWordHighlighting = (word: string, wordData: WordData) => {
  const elements = document.querySelectorAll(`.enx-${word.toLowerCase()}`)
  const colorCode = WordProcessor.getColorCode(wordData)

  elements.forEach(element => {
    if (element instanceof HTMLElement) {
      element.style.textDecoration = `${colorCode} underline`
      element.style.textDecorationThickness = '1px'
    }
  })
}

// Show authentication error message
const showSessionExpiredMessage = (isLoginError = false) => {
  // Remove any existing session message
  const existingMessage = document.getElementById('enx-session-expired')
  if (existingMessage) {
    existingMessage.remove()
  }

  const title = isLoginError ? 'Login Required' : 'Session Expired'
  const message = isLoginError 
    ? 'Please click the ENX extension icon to login.'
    : 'Your session has expired. Please click the ENX extension icon to login again.'

  // Create notification
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
        <div style="font-weight: bold; margin-bottom: 4px;">${title}</div>
        <div style="font-size: 13px; opacity: 0.9;">${message}</div>
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
const processArticleContent = async (): Promise<boolean> => {
  if (isProcessing) {
    console.log('Already processing, skipping...')
    return false
  }
  isProcessing = true

  try {
    console.log('Processing article content...')

    const articleNodes = WordProcessor.getArticleNodes()
    if (articleNodes.length === 0) {
      console.log('No article node found')
      return false
    }

    console.log(`Article node(s) found: ${articleNodes.length}`, articleNodes)

    // Get text content and extract words (script/style content excluded)
    const textContent = articleNodes
      .map(node => WordProcessor.cleanArticleText(node))
      .join(' ')
    const words = WordProcessor.extractWords(textContent)

    if (words.length === 0) {
      console.log('No words found to process')
      return false
    }

    // Deduplicate words to reduce chunk count and avoid redundant backend calls
    const uniqueWords = Array.from(new Set(words))
    console.log(`Found ${words.length} words (${uniqueWords.length} unique) to process`)

    // Process words in chunks
    const chunkSize = 200 // Process in smaller chunks for better performance
    let processedChunks = 0

    const sendChunkWithRetry = async (chunk: string[], attempt = 1): Promise<void> => {
      const paragraph = chunk.join(' ')
      try {
        const response = await sendToBackground({
          type: 'getWords',
          paragraph,
        })

        if (response.success && response.wordProperties) {
          // Check if wordProperties is wrapped in a 'data' field
          const actualWordData =
            response.wordProperties.data || response.wordProperties
          Object.assign(wordCache, actualWordData)
          processedChunks++
          console.log(
            `✅ Chunk ${processedChunks}: ${Object.keys(actualWordData).length} words cached`
          )
        } else if (response.sessionExpired) {
          throw new Error('SESSION_EXPIRED')
        } else if (attempt < 2) {
          // Retry once on failure (handles cold service worker or transient errors)
          console.warn(`⚠️ Chunk failed (attempt ${attempt}), retrying...`, response.error)
          await sendChunkWithRetry(chunk, attempt + 1)
        } else {
          console.error(`❌ Chunk failed after ${attempt} attempts:`, response.error)
        }
      } catch (error) {
        if (error instanceof Error && error.message === 'SESSION_EXPIRED') {
          throw error
        }
        if (attempt < 2) {
          console.warn(`⚠️ Chunk error (attempt ${attempt}), retrying...`, error)
          await sendChunkWithRetry(chunk, attempt + 1)
        } else {
          console.error(`❌ Chunk error after ${attempt} attempts:`, error)
        }
      }
    }

    for (let i = 0; i < uniqueWords.length; i += chunkSize) {
      const chunk = uniqueWords.slice(i, i + chunkSize)
      console.log(`📦 Processing chunk ${Math.floor(i / chunkSize) + 1}/${Math.ceil(uniqueWords.length / chunkSize)}: ${chunk.length} words`)

      try {
        await sendChunkWithRetry(chunk)
      } catch (error) {
        if (error instanceof Error && error.message === 'SESSION_EXPIRED') {
          console.log('Session expired during word processing')
          showSessionExpiredMessage()
          return false
        }
        console.error('Error processing word chunk:', error)
        // Continue processing other chunks
      }
    }

    // Apply highlighting to the article
    if (Object.keys(wordCache).length > 0) {
      console.log(
        'Applying highlighting for',
        Object.keys(wordCache).length,
        'words'
      )
      console.log(
        'Sample words from cache:',
        Object.keys(wordCache).slice(0, 5)
      )
      console.log('Sample word data:', Object.values(wordCache)[0])

      // Highlighting is applied independently to every matched article node
      articleNodes.forEach((articleNode, index) => {
        const originalHtml = articleNode.innerHTML
        const highlightedHtml = WordProcessor.renderWithHighlights(
          originalHtml,
          wordCache
        )

        console.log(
          `[node ${index}] Original HTML length:`, originalHtml.length,
          'Highlighted HTML length:', highlightedHtml.length
        )

        articleNode.innerHTML = highlightedHtml

        // Fix flex container issue: Find all span elements containing <u> elements
        // and force them to use display: inline instead of inline-flex or -webkit-inline-box
        const allSpans = articleNode.querySelectorAll('span')
        let fixedSpanCount = 0
        allSpans.forEach(span => {
          // Check if this span has <u.enx-word> children
          const hasUChildren = span.querySelector('u.enx-word')
          if (hasUChildren) {
            const computedStyle = window.getComputedStyle(span)
            if (computedStyle.display === 'inline-flex' || computedStyle.display === '-webkit-inline-box') {
              (span as HTMLElement).style.setProperty('display', 'inline', 'important')
              fixedSpanCount++
            }
          }
        })
        if (fixedSpanCount > 0) {
          console.log(`[node ${index}] Fixed ${fixedSpanCount} flex container spans to preserve whitespace`)
        }

        // Add click listeners to highlighted words
        addWordClickListeners(articleNode)
      })

      console.log('Word highlighting applied.')

      // Add processing complete indicator to the first node only
      addProcessingCompleteIndicator(articleNodes[0])

      console.log('✅ Article processing completed successfully')
      return true // Successfully processed and highlighted
    } else {
      console.log('No words in cache, skipping highlighting')
      return false // No words to highlight
    }
  } catch (error) {
    console.error('Error processing article:', error)
    return false // Processing failed
  } finally {
    isProcessing = false
  }
}

// Add click listeners to highlighted words
const addWordClickListeners = (container: Element) => {
  const wordElements = container.querySelectorAll('.enx-word')

  wordElements.forEach(element => {
    element.addEventListener('click', event => {
      event.preventDefault()
      event.stopPropagation()

      const word =
        (element as HTMLElement).dataset.word || element.textContent || ''
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
const enableEnx = async (): Promise<boolean> => {
  if (isEnxEnabled) {
    console.log('ENX already enabled')
    return false
  }

  console.log('Enabling ENX functionality')
  isEnxEnabled = true

  // Add mouseup listener for text selection
  document.addEventListener('mouseup', handleTextSelection)

  // Process article content and wait for completion
  const success = await processArticleContent()

  if (success) {
    console.log('✅ ENX enabled successfully with article processing')
  } else {
    console.warn('⚠️ ENX enabled but article processing had issues')
  }

  return success
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
      enableEnx()
        .then(result => {
          sendResponse({ success: true, completed: result })
        })
        .catch(error => {
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
        isEnxEnabled,
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

// Add global CSS for hover-based cursor on highlighted words
const wordStyles = document.createElement('style')
wordStyles.setAttribute('data-enx-word-styles', 'true')
wordStyles.textContent = `
  .enx-word {
    cursor: text;
    transition: all 0.15s ease;
  }

  .enx-word:hover {
    cursor: pointer;
    opacity: 0.8;
  }
`
if (!document.head.querySelector('style[data-enx-word-styles]')) {
  document.head.appendChild(wordStyles)
}

// Clean up on page unload
window.addEventListener('beforeunload', () => {
  hideWordPopup()
})

console.log('ENX Content script ready')
