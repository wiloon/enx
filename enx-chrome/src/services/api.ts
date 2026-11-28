import type {
  BackgroundRequest,
  BackgroundResponseOf,
} from '@/lib/messageContract'

interface SendMessageToBackground {
  // A declared request (lib/messageContract.ts) gets its own response type.
  <Request extends BackgroundRequest>(
    message: Request
  ): Promise<BackgroundResponseOf<Request>>
  // Untyped, for the callers not yet moved to the contract (#1280 removes it).
  <T = unknown>(message: unknown): Promise<T>
}

export const sendMessageToBackground = ((message: unknown) =>
  new Promise<unknown>((resolve, reject) => {
    chrome.runtime.sendMessage(message, response => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
      } else {
        resolve(response)
      }
    })
  })) as SendMessageToBackground
