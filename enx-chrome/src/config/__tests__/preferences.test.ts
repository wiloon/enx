import {
  WORD_HIGHLIGHT_KEY,
  HOVER_SENTENCE_TRANSLATE_KEY,
  HOVER_SENTENCE_SHADE_KEY,
  getWordHighlightEnabled,
  setWordHighlightEnabled,
  onWordHighlightEnabledChange,
  getHoverSentenceTranslateEnabled,
  setHoverSentenceTranslateEnabled,
  onHoverSentenceTranslateEnabledChange,
  getHoverSentenceShadeEnabled,
  setHoverSentenceShadeEnabled,
  onHoverSentenceShadeEnabledChange,
} from '@/config/preferences'

const storage = chrome.storage.local as unknown as {
  get: jest.Mock
  set: jest.Mock
}
const onChanged = chrome.storage.onChanged as unknown as {
  addListener: jest.Mock
  removeListener: jest.Mock
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('getWordHighlightEnabled', () => {
  it('returns true when the key is absent (default on)', async () => {
    storage.get.mockResolvedValue({})
    await expect(getWordHighlightEnabled()).resolves.toBe(true)
  })

  it('respects an explicit false', async () => {
    storage.get.mockResolvedValue({ [WORD_HIGHLIGHT_KEY]: false })
    await expect(getWordHighlightEnabled()).resolves.toBe(false)
  })

  it('respects an explicit true', async () => {
    storage.get.mockResolvedValue({ [WORD_HIGHLIGHT_KEY]: true })
    await expect(getWordHighlightEnabled()).resolves.toBe(true)
  })

  it('falls back to true if storage throws', async () => {
    storage.get.mockRejectedValue(new Error('no storage'))
    await expect(getWordHighlightEnabled()).resolves.toBe(true)
  })
})

describe('setWordHighlightEnabled', () => {
  it('writes the key', async () => {
    storage.set.mockResolvedValue(undefined)
    await setWordHighlightEnabled(false)
    expect(storage.set).toHaveBeenCalledWith({ [WORD_HIGHLIGHT_KEY]: false })
  })

  it('swallows a rejected write (does not throw)', async () => {
    storage.set.mockRejectedValue(new Error('quota'))
    await expect(setWordHighlightEnabled(true)).resolves.toBeUndefined()
  })
})

describe('onWordHighlightEnabledChange', () => {
  it('fires with the new value on a matching local change, ignores others', () => {
    const handler = jest.fn()
    onWordHighlightEnabledChange(handler)
    const listener = onChanged.addListener.mock.calls[0][0]

    listener({ [WORD_HIGHLIGHT_KEY]: { newValue: false } }, 'local')
    expect(handler).toHaveBeenCalledWith(false)

    handler.mockClear()
    listener({ [WORD_HIGHLIGHT_KEY]: { newValue: true } }, 'sync') // wrong area
    listener({ apiBaseUrl: { newValue: 'x' } }, 'local') // wrong key
    expect(handler).not.toHaveBeenCalled()
  })

  it('treats a removed key as the default (true)', () => {
    const handler = jest.fn()
    onWordHighlightEnabledChange(handler)
    const listener = onChanged.addListener.mock.calls[0][0]
    listener({ [WORD_HIGHLIGHT_KEY]: { oldValue: false } }, 'local') // no newValue
    expect(handler).toHaveBeenCalledWith(true)
  })

  it('unsubscribe removes the listener', () => {
    const unsubscribe = onWordHighlightEnabledChange(jest.fn())
    const listener = onChanged.addListener.mock.calls[0][0]
    unsubscribe()
    expect(onChanged.removeListener).toHaveBeenCalledWith(listener)
  })
})

describe('hover sentence translate preferences (ADR-068)', () => {
  it('defaults both switches on when absent', async () => {
    storage.get.mockResolvedValue({})
    await expect(getHoverSentenceTranslateEnabled()).resolves.toBe(true)
    await expect(getHoverSentenceShadeEnabled()).resolves.toBe(true)
  })

  it('reads and writes the translate switch', async () => {
    storage.get.mockResolvedValue({ [HOVER_SENTENCE_TRANSLATE_KEY]: false })
    await expect(getHoverSentenceTranslateEnabled()).resolves.toBe(false)
    storage.set.mockResolvedValue(undefined)
    await setHoverSentenceTranslateEnabled(true)
    expect(storage.set).toHaveBeenCalledWith({
      [HOVER_SENTENCE_TRANSLATE_KEY]: true,
    })
  })

  it('reads and writes the shade switch', async () => {
    storage.get.mockResolvedValue({ [HOVER_SENTENCE_SHADE_KEY]: false })
    await expect(getHoverSentenceShadeEnabled()).resolves.toBe(false)
    storage.set.mockResolvedValue(undefined)
    await setHoverSentenceShadeEnabled(false)
    expect(storage.set).toHaveBeenCalledWith({
      [HOVER_SENTENCE_SHADE_KEY]: false,
    })
  })

  it('notifies local storage changes for both keys', () => {
    const onTranslate = jest.fn()
    const onShade = jest.fn()
    onHoverSentenceTranslateEnabledChange(onTranslate)
    onHoverSentenceShadeEnabledChange(onShade)
    const translateListener = onChanged.addListener.mock.calls[0][0]
    const shadeListener = onChanged.addListener.mock.calls[1][0]

    translateListener(
      { [HOVER_SENTENCE_TRANSLATE_KEY]: { newValue: false } },
      'local'
    )
    shadeListener({ [HOVER_SENTENCE_SHADE_KEY]: { newValue: false } }, 'local')
    expect(onTranslate).toHaveBeenCalledWith(false)
    expect(onShade).toHaveBeenCalledWith(false)
  })
})
