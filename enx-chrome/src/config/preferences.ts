// User preferences kept in chrome.storage.local, read from the content
// script, popup and options page alike. Modelled on config/env.ts's
// getApiBaseUrl / setApiBaseUrl (ADR-011 Decision 3 / D1).

export const WORD_HIGHLIGHT_KEY = 'enx-word-highlight-enabled'

// Whether "highlight vocabulary while reading" is on. Absent = on.
export const getWordHighlightEnabled = async (): Promise<boolean> => {
  try {
    const result = await chrome.storage.local.get(WORD_HIGHLIGHT_KEY)
    return result[WORD_HIGHLIGHT_KEY] ?? true
  } catch (error) {
    console.warn('[ENX Config] failed to read word-highlight preference:', error)
    return true
  }
}

export const setWordHighlightEnabled = async (
  enabled: boolean
): Promise<void> => {
  try {
    await chrome.storage.local.set({ [WORD_HIGHLIGHT_KEY]: enabled })
  } catch (error) {
    console.error('[ENX Config] failed to save word-highlight preference:', error)
  }
}

// Fires whenever the preference changes (in this tab or another surface).
// Returns an unsubscribe function.
export const onWordHighlightEnabledChange = (
  handler: (enabled: boolean) => void
): (() => void) => {
  const listener = (
    changes: { [key: string]: chrome.storage.StorageChange },
    areaName: string
  ) => {
    if (areaName === 'local' && WORD_HIGHLIGHT_KEY in changes) {
      handler(changes[WORD_HIGHLIGHT_KEY].newValue ?? true)
    }
  }
  chrome.storage.onChanged.addListener(listener)
  return () => chrome.storage.onChanged.removeListener(listener)
}
