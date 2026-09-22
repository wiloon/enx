import { failureMessage } from '@/lib/enableOutcome'

export interface EnxRunResponse {
  success: boolean
  reason?: string
  error?: string
  adapter?: string
}

const NO_RECEIVER_MESSAGE = 'Receiving end does not exist'

function isNoReceiverError(err: unknown): boolean {
  return err instanceof Error && err.message.includes(NO_RECEIVER_MESSAGE)
}

// The declarative content_scripts[0] registered in the manifest is the same
// bundle X/RSSX/enx-ui get auto-injected -- reading its `js` path here keeps
// this in sync with whatever the build tool named the hashed output file,
// instead of hardcoding a path that would drift on every build.
async function injectContentScript(tabId: number): Promise<void> {
  const [script] = chrome.runtime.getManifest().content_scripts ?? []
  const files = script?.js
  if (!files || files.length === 0) {
    throw new Error('No content script registered in the manifest')
  }
  await chrome.scripting.executeScript({ target: { tabId }, files })
}

export async function enableLearningModeOnTab(
  tabId: number
): Promise<EnxRunResponse> {
  try {
    return await chrome.tabs.sendMessage(tabId, { action: 'enxRun' })
  } catch (err) {
    if (!isNoReceiverError(err)) throw err
  }

  try {
    await injectContentScript(tabId)
  } catch {
    // The browser itself refused the injection (chrome://, the Web Store,
    // a PDF viewer, ...) -- no retry can help, so this is a distinct,
    // permanent failure reason (adr-034 Decision 2), not the generic
    // "reload the extension" text that only fit the old always-injected
    // whitelist.
    return {
      success: false,
      reason: 'injection-blocked',
      error: failureMessage('injection-blocked'),
    }
  }

  return await sendEnxRunWithRetry(tabId)
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// The injected file is CRXJS's loader IIFE (dist/assets/*-loader-*.js): it
// kicks off an async import() of the real content-script bundle and its
// top-level code returns before that import finishes, so
// chrome.scripting.executeScript() resolving does NOT mean the real
// addListener call has run yet. A single immediate retry can still lose
// that race and throw the raw "Receiving end does not exist" straight at
// the user -- back off and retry a few times before giving up.
async function sendEnxRunWithRetry(tabId: number): Promise<EnxRunResponse> {
  const retryDelaysMs = [100, 250, 500, 1000]
  for (const delay of retryDelaysMs) {
    await sleep(delay)
    try {
      return await chrome.tabs.sendMessage(tabId, { action: 'enxRun' })
    } catch (err) {
      if (!isNoReceiverError(err)) throw err
    }
  }
  // Injection itself succeeded but the script never came up listening --
  // something past our control (slow network on the second chunk, an
  // uncaught error before addListener runs). The raw browser message isn't
  // useful to a user, so this becomes the generic failure reason rather
  // than propagating "Receiving end does not exist" verbatim.
  return { success: false, reason: 'error', error: failureMessage('error') }
}
