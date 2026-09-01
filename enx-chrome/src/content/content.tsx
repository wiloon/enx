// ENX Content Script for word identification and translation
// Note: Sentry initialization is skipped to avoid import issues in content script context

import { createRoot, type Root } from 'react-dom/client'
import { Provider } from 'jotai'
import { WordProcessor } from '@/lib/wordProcessor'
import { resolveSiteAdapter } from '@/lib/siteAdapters'
import { BackgroundResponse, ContentMessage, WordData } from '../types'
import { contentScriptStore } from './contentAtoms'
import {
  currentWordAtom,
  isTranslatingAtom,
  errorAtom,
  sentencePanelHintAtom,
} from '@/store/atoms'
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

// Shared Shadow DOM + CSS Anchor Positioning popup scaffold. Used by both
// the dictionary-lookup popup (showWordPopup) and the drag-select
// translation hint popup (showSelectionHint, ADR-007) -- anchors to the
// given element and returns an unmounted React root ready to render into.
// Requires Chrome 125+ for full support (CSS Anchor Positioning).
const createAnchoredPopup = (
  anchor: HTMLElement
): {
  popup: HTMLElement & { popover: string; showPopover: () => void; hidePopover: () => void }
  root: Root
} => {
  // 1. Mark the anchor element
  const anchorId = `enx-popup-anchor-${Date.now()}`
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
  // position-area: top prioritizes showing above the anchor, so the popup
  // covers already-read text rather than the upcoming sentence.
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

  return { popup, root }
}

// Create and show word popup using Popover API + CSS Anchor Positioning
const showWordPopup = async (word: string, event: MouseEvent) => {
  if (!word || word.trim() === '') return

  console.log('Showing popup for word:', word)

  // Remove existing popup
  hideWordPopup()

  const anchor = event.target as HTMLElement
  const { popup, root } = createAnchoredPopup(anchor)
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

  // Trigger path③ (spec §3.2): best-effort direct panel open, falling back to
  // "please click/right-click the toolbar icon" guidance if the click's user
  // gesture didn't survive being forwarded through runtime.sendMessage.
  const handleOpenSentencePanel = async () => {
    contentScriptStore.set(sentencePanelHintAtom, null)

    const sentenceContext = WordProcessor.extractSentenceContext(anchor, word)
    const sentence = sentenceContext?.sentence || word

    try {
      const response = await sendToBackground({
        type: 'openSentencePanel',
        word,
        sentence,
        sourceUrl: window.location.href,
      })

      if (response.success && !response.panelOpened) {
        contentScriptStore.set(
          sentencePanelHintAtom,
          '已保存，请点击或右键工具栏 ENX 图标查看整句翻译'
        )
      }
    } catch (error) {
      console.error('Error opening sentence panel:', error)
      contentScriptStore.set(
        sentencePanelHintAtom,
        '已保存，请点击或右键工具栏 ENX 图标查看整句翻译'
      )
    }
  }

  root.render(
    <Provider store={contentScriptStore}>
      <WordPopup
        word={word}
        onClose={() => popup.hidePopover()}
        onMarkAcquainted={handleMarkAcquainted}
        onOpenSentencePanel={handleOpenSentencePanel}
      />
    </Provider>
  )

  // 5. Show loading state
  contentScriptStore.set(currentWordAtom, null)
  contentScriptStore.set(isTranslatingAtom, true)
  contentScriptStore.set(errorAtom, null)
  contentScriptStore.set(sentencePanelHintAtom, null)

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

      // Mirror the lookup into the Side Panel's word list if it's open --
      // ADR-006. Routed through the background service worker rather than
      // writing chrome.storage.session directly: content scripts don't have
      // session-storage access unless the background grants it via
      // setAccessLevel(TRUSTED_AND_UNTRUSTED_CONTEXTS), and doing that would
      // also expose other session keys (e.g. the OAuth verifier) to content
      // scripts running on arbitrary third-party pages. This call never
      // triggers chrome.sidePanel.open() and never touches
      // PENDING_SENTENCE_STORAGE_KEY, so it can't force the panel open or
      // trigger sentence translation.
      sendToBackground({
        type: 'recordPageWordLookup',
        word: word.trim().toLowerCase(),
        ecp: wordData,
      })
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

// Update word highlighting color after a lookup / mark-acquainted. A word
// that drops to the "don't highlight" state (just acquainted, or LoadCount
// still 0) loses its underline entirely rather than getting a white one.
const updateWordHighlighting = (word: string, wordData: WordData) => {
  const elements = document.querySelectorAll(`.enx-${word.toLowerCase()}`)
  const decoration = WordProcessor.getTextDecoration(wordData)

  elements.forEach(element => {
    if (element instanceof HTMLElement) {
      element.style.textDecoration = decoration
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

    const adapter = resolveSiteAdapter(window.location)
    console.log(`Site adapter: ${adapter.name} (highlight: ${adapter.highlightStrategy})`)

    const articleNodes = WordProcessor.getArticleNodes({
      contentSelector: adapter.contentSelector,
      minTextLength: adapter.minTextLength,
      focusedNodeResolver: adapter.focusedNodeResolver,
    })
    if (articleNodes.length === 0) {
      console.log('No article node found')
      return false
    }

    console.log(`Article node(s) found: ${articleNodes.length}`, articleNodes)

    // inPlace strategy (ADR-010 Decision 3): word extraction and highlighting
    // share one TreeWalker pass per node, so their filter rules can't drift
    // apart. Joining text nodes with a space also stops a line-break-adjacent
    // pair ("...ENDGAME" + "Most...") from being read as one non-word token.
    const inPlace = adapter.highlightStrategy === 'inPlace'
    const collectedTextNodes: Text[][] = inPlace
      ? articleNodes.map(node => WordProcessor.collectTextNodes(node))
      : []

    // Get text content and extract words (script/style content excluded)
    const textContent = inPlace
      ? collectedTextNodes
          .flat()
          .map(n => n.textContent || '')
          .join(' ')
      : articleNodes.map(node => WordProcessor.cleanArticleText(node)).join(' ')
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
        if (inPlace) {
          // Wrap matched words directly in the live (React-owned) text nodes:
          // no innerHTML read/write, so React's element structure is untouched
          // (ADR-010 Decision 4).
          WordProcessor.applyHighlightsToNodes(collectedTextNodes[index], wordCache)
        } else {
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
        }

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

      // Add processing complete indicator to the first node only. Skipped for
      // adapters that opt out (ADR-010: the indicator is a structural
      // insertBefore into the content container, which conflicts with React).
      if (adapter.showProcessingIndicator) {
        addProcessingCompleteIndicator(articleNodes[0])
      }

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

// Shows a lightweight popup carrying only the sentencePanelHint text, no
// dictionary UI (ADR-007 Decision §4). Used by the drag-select translation
// flow for the two cases where the user needs feedback: the selection was
// rejected for being too long, or chrome.sidePanel.open() couldn't be
// triggered and the panel needs to be opened manually.
const showSelectionHint = (hint: string, event: MouseEvent) => {
  hideWordPopup()

  const anchor = event.target as HTMLElement
  const { popup, root } = createAnchoredPopup(anchor)
  currentRoot = root

  contentScriptStore.set(sentencePanelHintAtom, hint)

  root.render(
    <Provider store={contentScriptStore}>
      <WordPopup
        word=""
        variant="hint"
        onClose={() => popup.hidePopover()}
        onMarkAcquainted={() => {}}
        onOpenSentencePanel={() => {}}
      />
    </Provider>
  )

  document.body.appendChild(popup)
  popup.showPopover()
  currentPopup = popup

  setupPopupEventHandlers(popup, anchor, root)
}

// Drag-select translation (ADR-007): sends the selected text straight to
// the Side Panel via the same 'openSentencePanel' message the "🔤 整句翻译"
// button uses, skipping extractSentenceContext entirely -- the user's own
// selection boundary already is the translation boundary, unlike a single
// word click where the sentence has to be inferred from an anchor element.
// `word` is left blank: PendingSentenceContext.word isn't read anywhere in
// SidePanel.tsx, so there's nothing meaningful to put there for a selection
// that isn't anchored to one specific word.
const triggerSelectionTranslation = async (selectedText: string, event: MouseEvent) => {
  try {
    const response = await sendToBackground({
      type: 'openSentencePanel',
      word: '',
      sentence: selectedText,
      sourceUrl: window.location.href,
    })

    if (response.success && !response.panelOpened) {
      showSelectionHint('已保存，请点击或右键工具栏 ENX 图标查看整句翻译', event)
    }
  } catch (error) {
    console.error('Error opening sentence panel for selection:', error)
    showSelectionHint('已保存，请点击或右键工具栏 ENX 图标查看整句翻译', event)
  }
}

// Phrase-in-context lookup (ADR-008): a 2-5 word selection inside a larger
// sentence reuses the existing extractSentenceContext (built for single-word
// clicks) by finding one already-wrapped <u class="enx-word"> element inside
// the selection to use as its anchor, rather than writing a new
// Range-based sentence-boundary algorithm. See ADR-008 Decision §1.
const findPhraseAnchor = (event: MouseEvent): HTMLElement | null => {
  const target = event.target as HTMLElement
  if (target?.classList?.contains('enx-word')) return target

  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)

  let container = range.commonAncestorContainer as Node
  if (container.nodeType !== Node.ELEMENT_NODE) {
    container = container.parentElement as Node
  }
  if (!container || !(container instanceof HTMLElement)) return null

  const candidates = container.querySelectorAll('.enx-word')
  for (const candidate of Array.from(candidates)) {
    if (range.intersectsNode(candidate)) {
      return candidate as HTMLElement
    }
  }
  return null
}

// Sends the selected phrase + its surrounding sentence (found via the anchor
// above) to the Side Panel, reusing the same 'openSentencePanel' message and
// PENDING_SENTENCE_STORAGE_KEY plumbing as triggerSelectionTranslation, just
// with `phrase` set so SidePanel.tsx renders a phrase card (AI-only, no
// dictionary lookup) instead of the whole-sentence translation slot.
const triggerPhraseContextLookup = async (selectedText: string, event: MouseEvent) => {
  const anchor = findPhraseAnchor(event)
  if (!anchor) {
    showSelectionHint('暂时无法识别所在句子，请尝试重新选择', event)
    return
  }

  const sentenceContext = WordProcessor.extractSentenceContext(anchor, anchor.textContent || '')
  const sentence = sentenceContext?.sentence
  if (!sentence) {
    showSelectionHint('暂时无法识别所在句子，请尝试重新选择', event)
    return
  }

  try {
    const response = await sendToBackground({
      type: 'openSentencePanel',
      word: '',
      phrase: selectedText,
      sentence,
      sourceUrl: window.location.href,
    })

    if (response.success && !response.panelOpened) {
      showSelectionHint('已保存，请点击或右键工具栏 ENX 图标查看', event)
    }
  } catch (error) {
    console.error('Error opening phrase panel for selection:', error)
    showSelectionHint('已保存，请点击或右键工具栏 ENX 图标查看', event)
  }
}

// ADR-007 tuning constants, kept together so they're easy to adjust without
// hunting through the selection-handling logic below.
const SELECTION_DICTIONARY_MAX_WORDS = 5
const SELECTION_TRANSLATE_MAX_WORDS = 80
const SELECTION_TRANSLATE_DEBOUNCE_MS = 500
const SENTENCE_END_PUNCTUATION = /[.?!]/

let selectionTranslateTimer: ReturnType<typeof setTimeout> | null = null

// Cancels any pending drag-select translation. Called both on the next
// mousedown (a new selection gesture starting -- ADR-007 Decision §3) and
// whenever a mouseup itself needs to replace a still-pending timer.
const cancelPendingSelectionTranslation = () => {
  if (selectionTranslateTimer !== null) {
    clearTimeout(selectionTranslateTimer)
    selectionTranslateTimer = null
  }
}

// Handle text selection (ADR-007/ADR-008): a selection with sentence-ending
// punctuation, or longer than the dictionary-lookup threshold, is treated
// as "translate this" rather than "look this phrase up" and is debounced
// before triggering translateSentence (via triggerSelectionTranslation) --
// see the ADR for why word-count alone can't tell a short phrase like "as a
// matter of fact" apart from a short complete sentence like "I love cats.".
// Within the remaining <=5-word, no-punctuation range, a single word is
// still a dictionary lookup, but 2-5 words is a phrase -- ECDICT/words never
// has phrase entries, so that case is routed to an AI in-context lookup
// instead (ADR-008), not debounced since the selection itself is already
// the exact, deliberate query (no boundary-tuning drag to wait out).
const handleTextSelection = (event: MouseEvent) => {
  cancelPendingSelectionTranslation()

  const selection = window.getSelection()
  const selectedText = selection?.toString().trim()
  if (!selectedText) return

  const wordCount = selectedText.split(/\s+/).filter(Boolean).length

  if (wordCount > SELECTION_TRANSLATE_MAX_WORDS) {
    showSelectionHint(
      `选中内容过长，请缩小选择范围（最多 ${SELECTION_TRANSLATE_MAX_WORDS} 个词）`,
      event
    )
    return
  }

  const looksLikeSentence = SENTENCE_END_PUNCTUATION.test(selectedText)
  if (looksLikeSentence || wordCount > SELECTION_DICTIONARY_MAX_WORDS) {
    selectionTranslateTimer = setTimeout(() => {
      selectionTranslateTimer = null
      triggerSelectionTranslation(selectedText, event)
    }, SELECTION_TRANSLATE_DEBOUNCE_MS)
    return
  }

  if (wordCount === 1) {
    // Single word, no sentence-ending punctuation: existing dictionary lookup.
    showWordPopup(selectedText, event)
    return
  }

  // 2-5 words, no sentence-ending punctuation: phrase-in-context AI lookup (ADR-008).
  triggerPhraseContextLookup(selectedText, event)
}

// Enable ENX functionality
const enableEnx = async (): Promise<boolean> => {
  if (isEnxEnabled) {
    console.log('ENX already enabled')
    return false
  }

  console.log('Enabling ENX functionality')
  isEnxEnabled = true

  // Add mouseup listener for text selection, and mousedown to cancel a
  // pending drag-select translation as soon as a new selection gesture
  // starts (ADR-007 Decision §3).
  document.addEventListener('mouseup', handleTextSelection)
  document.addEventListener('mousedown', cancelPendingSelectionTranslation)

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
  document.removeEventListener('mousedown', cancelPendingSelectionTranslation)
  cancelPendingSelectionTranslation()

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
    case 'enxRun': {
      // ADR-010 Decision 1: an adapter can match the host but declare the
      // current page out of scope (X list/timeline pages vs a tweet detail
      // page). Abort with the adapter's message rather than silently doing
      // nothing.
      const adapter = resolveSiteAdapter(window.location)
      const unsupportedReason = adapter.pageSupport?.(window.location)
      if (unsupportedReason) {
        sendResponse({ success: false, error: unsupportedReason })
        break
      }

      // ADR-010 Decision 7 (G2): "enable once" becomes "re-arm". On an
      // already-enabled page (e.g. X after an in-page navigation swapped the
      // DOM), tear down and re-run instead of the old no-op early return.
      // wordCache is module-level and survives, so re-processed words hit the
      // cache and don't re-call the backend.
      if (isEnxEnabled) {
        disableEnx()
      }

      enableEnx()
        .then(result => {
          sendResponse({ success: true, completed: result })
        })
        .catch(error => {
          console.error('Error enabling ENX:', error)
          sendResponse({ success: false, error: error.message })
        })
      return true // Keep message channel open for async response
    }

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
