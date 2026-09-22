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

  return await chrome.tabs.sendMessage(tabId, { action: 'enxRun' })
}
