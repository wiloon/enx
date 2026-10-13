import type { BackgroundResponse } from '@/types'

// A content script outlives its extension: when Catglish is reloaded or
// updated, Chrome leaves the old script running in every open tab -- the
// underlines and click handlers still work -- but cuts its channel to the new
// service worker. Every chrome.runtime call from it then throws "Extension
// context invalidated". Nothing on the network is wrong, and only reloading
// the page injects a script that can talk to the extension again.
export const EXTENSION_UPDATED_MESSAGE =
  'Catglish was updated. Reload this page to keep looking up words.'

// For a lookup that failed in the content script itself, after the message
// went out (a bug, not the network: network failures come back from the
// background as NETWORK_ERROR_MESSAGE).
export const LOOKUP_FAILED_MESSAGE = 'Something went wrong. Please try again.'

type Runtime = Pick<typeof chrome.runtime, 'id' | 'sendMessage' | 'lastError'>

export const isExtensionContextInvalidated = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return message.includes('Extension context invalidated')
}

// chrome.runtime.sendMessage for a content script: never rejects, and says
// `extensionUpdated: true` when the script has been cut off from the
// extension (see above). `runtime` is a parameter for tests.
export const sendRuntimeMessage = (
  message: unknown,
  runtime: Runtime | undefined = chrome.runtime
): Promise<BackgroundResponse> => {
  const extensionUpdated: BackgroundResponse = {
    success: false,
    error: EXTENSION_UPDATED_MESSAGE,
    extensionUpdated: true,
  }
  // An orphaned script's runtime has lost its id before any call throws.
  if (!runtime?.id) return Promise.resolve(extensionUpdated)

  return new Promise(resolve => {
    try {
      runtime.sendMessage(message, (response?: BackgroundResponse) => {
        if (
          !response &&
          isExtensionContextInvalidated(runtime.lastError?.message)
        ) {
          resolve(extensionUpdated)
          return
        }
        resolve(response || { success: false, error: 'No response' })
      })
    } catch (error) {
      resolve(
        isExtensionContextInvalidated(error)
          ? extensionUpdated
          : { success: false, error: LOOKUP_FAILED_MESSAGE }
      )
    }
  })
}
