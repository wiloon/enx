// ENX Background Script - Handles API communication and message routing
// Note: Sentry initialization is skipped in service worker context to avoid import issues

import { createClerkClient } from '@clerk/chrome-extension/background'
import { config, getApiBaseUrl } from '@/config/env'
import {
  LATEST_PAGE_WORD_STORAGE_KEY,
  LatestPageWordLookup,
  PENDING_SENTENCE_STORAGE_KEY,
  PendingSentenceContext,
  WordData,
} from '@/types'

console.log('ENX Background script loaded')
console.log('🌐 Config environment:', config.environment)

// ADR-015: Clerk owns the session. The service worker holds a single Clerk
// client (synced from the website via `syncHost`) and mints a fresh, short-
// lived session JWT for every API call via `session.getToken()`.
type ClerkClient = Awaited<ReturnType<typeof createClerkClient>>
let clerkClientPromise: Promise<ClerkClient> | null = null

const getClerk = (): Promise<ClerkClient> => {
  if (!clerkClientPromise) {
    clerkClientPromise = createClerkClient({
      publishableKey: config.clerkPublishableKey,
      syncHost: config.clerkSyncHost,
    })
  }
  return clerkClientPromise
}

// Mitigation for a false "session expired": homelab still runs Clerk's
// *development* instance (see TASK-SPEC-enx-clerk-production-cutover.md),
// which syncs the session into the extension via a dev-browser-JWT relay
// instead of a shared prod cookie. MV3 evicts an idle service worker, wiping
// `clerkClientPromise`; when a new event wakes it, the relay handshake can
// still be in flight, so the freshly-created client resolves with no session
// even though the user is still signed in on the website. If that happens,
// throw away the cached client and retry once with a brand-new one before
// concluding the session is genuinely gone (a still-empty session after the
// retry is treated as a real 401/logout).
const getSyncedClerk = async (): Promise<ClerkClient> => {
  const clerk = await getClerk()
  if (clerk.session) return clerk

  clerkClientPromise = null
  return getClerk()
}

const getSessionToken = async (): Promise<string | null> => {
  try {
    const clerk = await getSyncedClerk()
    return (await clerk.session?.getToken()) ?? null
  } catch (error) {
    console.error('Clerk getToken failed:', error)
    return null
  }
}

const isSignedIn = async (): Promise<boolean> => {
  try {
    return Boolean((await getSyncedClerk()).session)
  } catch (error) {
    console.error('Clerk session check failed:', error)
    return false
  }
}

// Handle session expiry: Clerk manages token lifetime, so a 401 means the
// session is genuinely gone. Nudge the active tab's content script to prompt
// re-login (the popup renders Clerk's <SignIn/>).
const handleSessionExpiry = async () => {
  console.log('Session expired (401 from API)')

  // Try to open the extension popup to show login form
  try {
    // Get current active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab?.id) {
      // Send message to content script to show a notification about session expiry
      chrome.tabs
        .sendMessage(tab.id, {
          action: 'sessionExpired',
          message:
            'Your session has expired. Please click the extension icon to login again.',
        })
        .catch(() => {
          // Ignore errors if content script is not available
          console.log('Could not notify content script about session expiry')
        })
    }
  } catch (error) {
    console.error('Error handling session expiry:', error)
  }
}

export type ApiRequestResult = {
  success: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: any
  error?: string
  sessionExpired?: boolean
  // HTTP status of a failed response (undefined for network-level failures
  // that never got a response at all). Lets callers distinguish billing
  // errors -- 402 insufficient AI credit, 429 daily dictionary quota
  // exceeded -- from a generic failure, so the UI can point the user at
  // /billing instead of just showing "translation failed" (TASK-SPEC
  // §4.1/§4.2, Phase 4).
  status?: number
}

// API request helper
export const makeApiRequest = async (
  endpoint: string,
  options: RequestInit = {}
): Promise<ApiRequestResult> => {
  try {
    const API_BASE_URL = await getApiBaseUrl()
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    }

    const token = await getSessionToken()
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers,
    })

    console.log(
      `API response status: ${response.status} ${response.statusText}`
    )

    if (!response.ok) {
      if (response.status === 401) {
        await handleSessionExpiry()
        throw new Error('Session expired')
      }

      // Try to get error details from response body
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`
      try {
        const errorData = await response.json()
        if (errorData.error || errorData.message) {
          errorMessage = errorData.error || errorData.message
        }
      } catch (e) {
        // Ignore JSON parsing errors, use default message
      }

      // Returned directly (not thrown) so response.status survives into
      // ApiRequestResult -- the catch block below only handles genuine
      // exceptions (network failure, session expiry) that never got a
      // real HTTP status.
      return { success: false, error: errorMessage, status: response.status }
    }

    const data = await response.json()
    console.log('API response data:', data)
    return { success: true, data }
  } catch (error) {
    console.error('API request failed:', error)

    // Check if this is a session expiry error
    if (error instanceof Error && error.message === 'Session expired') {
      return {
        success: false,
        error: 'Your session has expired. Please login again.',
        sessionExpired: true,
      }
    }

    // Network errors
    if (
      error instanceof TypeError &&
      error.message.includes('Failed to fetch')
    ) {
      return {
        success: false,
        error:
          'Unable to connect to translation service. Please check your internet connection.',
      }
    }

    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : 'Translation service temporarily unavailable',
    }
  }
}

// Handle extension installation
chrome.runtime.onInstalled.addListener(async details => {
  console.log('ENX Extension installed:', details.reason)

  if (details.reason === 'install') {
    console.log('ENX Extension installed for the first time')
    // Initialize storage
    await chrome.storage.local.set({
      enxEnabled: false,
      wordCache: {},
    })
  } else if (details.reason === 'update') {
    console.log('ENX Extension updated')
  }

  // Warm the Clerk client (syncs the session from the website via syncHost).
  void getClerk()

  // Trigger path② (spec §3.2): a right-click menu item is a Chrome-approved
  // user gesture source, same as an actual click, so sidePanel.open() called
  // from its onClicked handler is reliable -- unlike forwarding a content
  // script's click through runtime.sendMessage (trigger path③).
  chrome.contextMenus.create(
    {
      id: 'enx-open-sentence-panel',
      title: '打开整句翻译面板',
      contexts: ['action'],
    },
    () => {
      // Re-registering an existing id throws via chrome.runtime.lastError
      // (not a JS exception) on repeated onInstalled "update" events; that's
      // expected, not an error worth surfacing.
      if (chrome.runtime.lastError) {
        console.debug('contextMenus.create:', chrome.runtime.lastError.message)
      }
    }
  )
})

// Trigger path② (spec §3.2): right-click the toolbar icon -> menu item ->
// open the Side Panel directly. Independent of the left-click default_popup
// behavior (trigger path①), so it can't interfere with login/logout.
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'enx-open-sentence-panel') return
  if (tab?.windowId === undefined) return

  try {
    await chrome.sidePanel.open({ windowId: tab.windowId })
  } catch (error) {
    console.error('Failed to open side panel from context menu:', error)
  }
})

// Handle extension icon clicks
chrome.action.onClicked.addListener(async tab => {
  console.log('ENX Extension icon clicked', tab)

  // Check if user is logged in (Clerk session synced from the website)
  if (!(await isSignedIn())) {
    console.log('User not logged in, popup will handle this')
    return
  }

  // Toggle ENX functionality on current tab
  if (tab.id) {
    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'enxRun' })
    } catch (error) {
      console.error('Error sending message to tab:', error)
    }
  }
})

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Background received message:', request)

  // Trigger path③ (spec §3.2): chrome.sidePanel.open() only works inside the
  // user gesture that Chrome forwards with a content-script runtime.sendMessage,
  // and that gesture is spent by the first `await`. So fire open() here --
  // synchronously, before handleAsync()'s storage writes -- rather than inside
  // handleOpenSentencePanel. Its outcome is awaited later via this promise.
  const sentencePanelOpening =
    (request.type || request.action) === 'openSentencePanel'
      ? openSentencePanelForGesture(sender.tab?.id)
      : undefined

  // Handle async responses
  const handleAsync = async () => {
    try {
      switch (request.type || request.action) {
        case 'getOneWord':
          return await handleGetOneWord(request.word)

        case 'getWords':
          return await handleGetWords(request.paragraph)

        case 'markAcquainted':
          return await handleMarkAcquainted(request.word, request.userId)

        case 'openSentencePanel':
          return await handleOpenSentencePanel(
            request.word || '',
            request.sentence || request.word || '',
            request.sourceUrl || '',
            request.phrase || undefined,
            sentencePanelOpening
          )

        case 'recordPageWordLookup':
          return await handleRecordPageWordLookup(request.word || '', request.ecp)

        case 'translateSentence':
          return await handleTranslateSentence(request.sentence || '')

        case 'translateWordInContext':
          return await handleTranslateWordInContext(
            request.sentence || '',
            request.word || ''
          )

        case 'translateSentenceWithWord':
          return await handleTranslateSentenceWithWord(
            request.sentence || '',
            request.word || ''
          )

        case 'validateSession':
          return await makeApiRequest('/api/me')

        case 'debugStorage':
          // Debug command to check storage
          const storageData = await chrome.storage.local.get(null)
          console.log('All Chrome storage data:', storageData)
          return {
            success: true,
            storage: storageData,
            signedIn: await isSignedIn(),
          }

        case 'hello':
          return { success: true, message: 'Hello from ENX background!' }

        default:
          return {
            success: false,
            error: 'Unknown action: ' + (request.type || request.action),
          }
      }
    } catch (error) {
      console.error('Error handling message:', error)
      return { success: false, error: 'Internal error' }
    }
  }

  // Execute async handler and send response
  handleAsync().then(sendResponse)

  return true // Keep the message channel open for async response
})

// Sign-in / sign-out now happen in the popup via Clerk's <SignIn/> and
// <SignOutButton/> (ADR-015); the service worker just reads the synced session.

// Handle get one word translation
const handleGetOneWord = async (word: string) => {
  if (!word || word.trim() === '') {
    return { success: false, error: 'No word provided' }
  }

  console.log('Handling getOneWord request for:', word)
  const encodedWord = encodeURIComponent(word.trim())
  const response = await makeApiRequest(`/api/translate?word=${encodedWord}`)

  console.log('API response for word translation:', response)

  if (response.success) {
    console.log(
      'API response data structure:',
      JSON.stringify(response.data, null, 2)
    )

    // Check multiple possible response formats
    if (response.data) {
      // Try different possible data structures
      const ecp = response.data.ecp || response.data.word || response.data

      if (ecp && (ecp.English || ecp.Chinese || ecp.Pronunciation)) {
        console.log('Found word data:', ecp)
        return {
          success: true,
          ecp: ecp,
        }
      }

      // If we have any data at all, try to use it
      if (response.data.English || response.data.Chinese) {
        console.log('Using direct response data as word data')
        return {
          success: true,
          ecp: response.data,
        }
      }
    }

    console.error(
      'API returned success but unexpected data format:',
      response.data
    )
    return {
      success: false,
      error: 'Unexpected response format from translation service',
    }
  } else {
    console.error('API request failed:', response.error)
    // Pass through session expiry flag and status (e.g. 429 daily quota)
    return {
      success: false,
      error: response.error || 'Translation service error',
      sessionExpired: response.sessionExpired,
      status: response.status,
    }
  }
}

// Handle get multiple words
const handleGetWords = async (paragraph: string) => {
  if (!paragraph || paragraph.trim() === '') {
    return { success: false, error: 'No paragraph provided' }
  }

  const encodedParagraph = encodeURIComponent(paragraph)
  const response = await makeApiRequest(
    `/api/paragraph-init?paragraph=${encodedParagraph}`
  )

  console.log('paragraph-init API response:', response)

  if (response.success) {
    const wordCount = Object.keys(response.data || {}).length
    console.log('Word properties received:', wordCount, 'words')
    if (wordCount > 0) {
      console.log('Sample words:', Object.keys(response.data).slice(0, 5))
      console.log('Sample word data:', Object.values(response.data)[0])
    }
    return {
      success: true,
      wordProperties: response.data,
    }
  } else {
    // Pass through session expiry flag
    return {
      success: false,
      error: response.error,
      sessionExpired: response.sessionExpired,
    }
  }
}

// Handle mark word as acquainted
const handleMarkAcquainted = async (word: string, userId: number) => {
  if (!word) {
    console.error('handleMarkAcquainted: Missing word', { word })
    return { success: false, error: 'Missing word' }
  }

  console.log('handleMarkAcquainted: Marking word as acquainted', {
    word: word.trim(),
    userId,
  })

  // Check if we have a Clerk session (synced from the website).
  if (!(await isSignedIn())) {
    console.error('handleMarkAcquainted: no Clerk session')
    return {
      success: false,
      error: 'Session expired. Please click the extension icon to login again.',
      sessionExpired: true,
    }
  }

  const response = await makeApiRequest('/api/mark', {
    method: 'POST',
    body: JSON.stringify({
      English: word.trim(),
    }),
  })

  console.log('handleMarkAcquainted: API response', response)
  console.log(
    'handleMarkAcquainted: API response data structure:',
    JSON.stringify(response.data, null, 2)
  )

  if (response.success) {
    console.log('handleMarkAcquainted: Word marked successfully')
    console.log(
      'handleMarkAcquainted: Returning ecp data:',
      response.data?.ecp || response.data
    )
    return {
      success: true,
      ecp: response.data?.ecp || response.data,
    }
  } else {
    console.error('handleMarkAcquainted: Failed to mark word', response.error)
    // Pass through session expiry flag
    return {
      success: false,
      error: response.error,
      sessionExpired: response.sessionExpired,
    }
  }
}

// Handle whole-sentence AI translation for the Side Panel (spec §3.5/§3.7).
const handleTranslateSentence = async (sentence: string) => {
  if (!sentence || sentence.trim() === '') {
    return { success: false, error: 'No sentence provided' }
  }

  const response = await makeApiRequest('/api/translate/sentence', {
    method: 'POST',
    body: JSON.stringify({ sentence: sentence.trim() }),
  })

  if (response.success && response.data?.chinese) {
    return { success: true, chinese: response.data.chinese as string }
  }

  return {
    success: false,
    error: response.error || 'Translation service unavailable',
    sessionExpired: response.sessionExpired,
    status: response.status,
  }
}

// Handle the combined "translate the whole sentence AND gloss the clicked
// word in that sentence's context" call (ADR-014): one AI round-trip that
// backs the Side Panel opened from a word click, replacing a separate
// translateSentence + translateWordInContext pair. `wordChinese` comes back
// empty if the model omitted it -- SidePanel.tsx then falls back to a
// standalone translateWordInContext call.
const handleTranslateSentenceWithWord = async (sentence: string, word: string) => {
  if (
    !sentence ||
    sentence.trim() === '' ||
    !word ||
    word.trim() === ''
  ) {
    return { success: false, error: 'sentence and word are required' }
  }

  const response = await makeApiRequest('/api/translate/sentence-with-word', {
    method: 'POST',
    body: JSON.stringify({ sentence: sentence.trim(), word: word.trim() }),
  })

  if (response.success && response.data?.chinese) {
    return {
      success: true,
      chinese: response.data.chinese as string,
      wordChinese: (response.data.wordChinese as string) || '',
    }
  }

  return {
    success: false,
    error: response.error || 'Translation service unavailable',
    sessionExpired: response.sessionExpired,
    status: response.status,
  }
}

// Handle a single word's contextual translation for the Side Panel word-click
// flow (spec §3.7/§3.8): unlike getOneWord/ECDICT, this returns the word's
// meaning as used in the given sentence, not a generic dictionary gloss.
const handleTranslateWordInContext = async (sentence: string, word: string) => {
  if (!sentence || sentence.trim() === '' || !word || word.trim() === '') {
    return { success: false, error: 'sentence and word are required' }
  }

  const response = await makeApiRequest('/api/translate/word-in-context', {
    method: 'POST',
    body: JSON.stringify({ sentence: sentence.trim(), word: word.trim() }),
  })

  if (response.success && response.data?.chinese) {
    return { success: true, chinese: response.data.chinese as string }
  }

  return {
    success: false,
    error: response.error || 'Translation service unavailable',
    sessionExpired: response.sessionExpired,
    status: response.status,
  }
}

// Best-effort chrome.sidePanel.open() for trigger path③, called synchronously
// from the onMessage listener so it runs inside the user gesture Chrome
// forwards with a content-script runtime.sendMessage -- any `await` before
// open() spends that gesture. Resolves true if the panel opened (or was
// already open: open() on an open panel is a harmless no-op), false if the
// gesture didn't forward, so the caller can fall back to trigger paths①/②
// (toolbar icon / right-click menu), which read the same persisted context.
const openSentencePanelForGesture = (tabId?: number): Promise<boolean> => {
  if (tabId === undefined) return Promise.resolve(false)
  return chrome.sidePanel
    .open({ tabId })
    .then(() => true)
    .catch(error => {
      console.warn(
        'openSentencePanelForGesture: sidePanel.open() failed (expected if the gesture did not forward):',
        error
      )
      return false
    })
}

// Handle "整句翻译" (trigger path③, spec §3.2/§3.3): persist the pending sentence
// context, then report whether openSentencePanelForGesture() (fired earlier by
// the onMessage listener) managed to open the panel.
//
// If the Side Panel is *already* open we don't need a user gesture at all:
// SidePanel.tsx re-reads PENDING_SENTENCE_STORAGE_KEY on storage.onChanged and
// refreshes in place (spec §4.6). We detect that via chrome.runtime.getContexts
// (Chrome 116+) and report panelOpened:true so the caller suppresses the
// "click the toolbar icon" hint.
const isSidePanelOpen = async (): Promise<boolean> => {
  try {
    // Query everything and match in JS rather than passing contextTypes as a
    // filter: chrome.runtime.ContextType can be undefined at runtime. We also
    // don't gate on the context's windowId -- it's unreliable across Chrome
    // builds and frequently doesn't match sender.tab.windowId. A cross-window
    // false positive only means another window's open panel also refreshes,
    // which is harmless.
    const contexts = (await chrome.runtime.getContexts?.({})) ?? []
    return contexts.some(
      c => c.contextType === ('SIDE_PANEL' as chrome.runtime.ContextType)
    )
  } catch (error) {
    console.warn('isSidePanelOpen: getContexts() failed:', error)
    return false
  }
}

const handleOpenSentencePanel = async (
  word: string,
  sentence: string,
  sourceUrl: string,
  phrase?: string,
  panelOpening?: Promise<boolean>
) => {
  const context: PendingSentenceContext = {
    word,
    sentence,
    phrase,
    sourceUrl,
    createdAt: Date.now(),
  }
  await chrome.storage.session.set({ [PENDING_SENTENCE_STORAGE_KEY]: context })

  // The onMessage listener already fired sidePanel.open() inside the forwarded
  // gesture; await its outcome here. Fall back to a getContexts() probe in case
  // open() rejected but the panel is in fact already open -- SidePanel.tsx then
  // picks up the new context via storage.onChanged (spec §4.6) and no hint is
  // needed.
  let panelOpened = panelOpening ? await panelOpening : false
  if (!panelOpened) {
    panelOpened = await isSidePanelOpen()
  }

  return { success: true, panelOpened }
}

// Mirrors a page-level WordPopup lookup into the Side Panel's word list
// (ADR-006). Content scripts can't write chrome.storage.session directly
// (no access unless the background grants TRUSTED_AND_UNTRUSTED_CONTEXTS,
// which would also expose other session keys like the OAuth verifier to
// arbitrary web pages), so this proxies the write the same way
// handleOpenSentencePanel does for PENDING_SENTENCE_STORAGE_KEY. Overwrite
// only -- no history -- and deliberately never touches
// PENDING_SENTENCE_STORAGE_KEY or calls chrome.sidePanel.open().
const handleRecordPageWordLookup = async (word: string, ecp?: WordData) => {
  if (!word || !ecp) return { success: false, error: 'Missing word or dictionary data' }

  const lookup: LatestPageWordLookup = { word, ecp, createdAt: Date.now() }
  await chrome.storage.session.set({ [LATEST_PAGE_WORD_STORAGE_KEY]: lookup })

  return { success: true }
}

// Handle service worker errors
self.addEventListener('error', event => {
  console.error('ENX Service worker error:', event.error)
})

// Handle unhandled promise rejections
self.addEventListener('unhandledrejection', event => {
  console.error('ENX Unhandled promise rejection:', event.reason)
})

// Initialize background script
const initialize = async () => {
  await getClerk()
  console.log('ENX Background script initialization complete')
}

initialize()
