// User preferences kept in chrome.storage.local, read from the content
// script, popup and options page alike (ADR-011 Decision 3 / D1).

export const WORD_HIGHLIGHT_KEY = 'enx-word-highlight-enabled'

// Whether "highlight vocabulary while reading" is on. Absent = on.
export const getWordHighlightEnabled = async (): Promise<boolean> => {
  try {
    const result = await chrome.storage.local.get<{
      [WORD_HIGHLIGHT_KEY]?: boolean
    }>(WORD_HIGHLIGHT_KEY)
    return result[WORD_HIGHLIGHT_KEY] ?? true
  } catch (error) {
    console.warn(
      '[ENX Config] failed to read word-highlight preference:',
      error
    )
    return true
  }
}

export const setWordHighlightEnabled = async (
  enabled: boolean
): Promise<void> => {
  try {
    await chrome.storage.local.set({ [WORD_HIGHLIGHT_KEY]: enabled })
  } catch (error) {
    console.error(
      '[ENX Config] failed to save word-highlight preference:',
      error
    )
  }
}

export const ARTICLE_CHOICE_SHARING_KEY = 'enx-article-choice-sharing'

// Whether confirmed article choices are shared (ADR-073 decision 5). Absent =
// not answered yet: nothing is shared and the popup asks before picking.
// Errors propagate, so an answer is never assumed to have been saved.
export const getArticleChoiceSharing = async (): Promise<boolean | null> => {
  const result = await chrome.storage.local.get<{
    [ARTICLE_CHOICE_SHARING_KEY]?: boolean
  }>(ARTICLE_CHOICE_SHARING_KEY)
  const value = result?.[ARTICLE_CHOICE_SHARING_KEY]
  return typeof value === 'boolean' ? value : null
}

export const setArticleChoiceSharing = async (share: boolean): Promise<void> =>
  chrome.storage.local.set({ [ARTICLE_CHOICE_SHARING_KEY]: share })

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
      handler(
        (changes[WORD_HIGHLIGHT_KEY].newValue as boolean | undefined) ?? true
      )
    }
  }
  chrome.storage.onChanged.addListener(listener)
  return () => chrome.storage.onChanged.removeListener(listener)
}

// Hover sentence-translate button (ADR-068). Both default on; local only.
export const HOVER_SENTENCE_TRANSLATE_KEY = 'enx-hover-sentence-translate-enabled'
export const HOVER_SENTENCE_SHADE_KEY = 'enx-hover-sentence-shade-enabled'

const readLocalBool = async (
  key: string,
  fallback: boolean
): Promise<boolean> => {
  try {
    const result = await chrome.storage.local.get<{ [k: string]: boolean }>(key)
    return result[key] ?? fallback
  } catch (error) {
    console.warn(`[ENX Config] failed to read ${key}:`, error)
    return fallback
  }
}

const writeLocalBool = async (key: string, value: boolean): Promise<void> => {
  try {
    await chrome.storage.local.set({ [key]: value })
  } catch (error) {
    console.error(`[ENX Config] failed to save ${key}:`, error)
  }
}

const onLocalBoolChange = (
  key: string,
  handler: (enabled: boolean) => void,
  fallback = true
): (() => void) => {
  const listener = (
    changes: { [key: string]: chrome.storage.StorageChange },
    areaName: string
  ) => {
    if (areaName === 'local' && key in changes) {
      handler((changes[key].newValue as boolean | undefined) ?? fallback)
    }
  }
  chrome.storage.onChanged.addListener(listener)
  return () => chrome.storage.onChanged.removeListener(listener)
}

export const getHoverSentenceTranslateEnabled = (): Promise<boolean> =>
  readLocalBool(HOVER_SENTENCE_TRANSLATE_KEY, true)

export const setHoverSentenceTranslateEnabled = (
  enabled: boolean
): Promise<void> => writeLocalBool(HOVER_SENTENCE_TRANSLATE_KEY, enabled)

export const onHoverSentenceTranslateEnabledChange = (
  handler: (enabled: boolean) => void
): (() => void) =>
  onLocalBoolChange(HOVER_SENTENCE_TRANSLATE_KEY, handler)

export const getHoverSentenceShadeEnabled = (): Promise<boolean> =>
  readLocalBool(HOVER_SENTENCE_SHADE_KEY, true)

export const setHoverSentenceShadeEnabled = (
  enabled: boolean
): Promise<void> => writeLocalBool(HOVER_SENTENCE_SHADE_KEY, enabled)

export const onHoverSentenceShadeEnabledChange = (
  handler: (enabled: boolean) => void
): (() => void) => onLocalBoolChange(HOVER_SENTENCE_SHADE_KEY, handler)
