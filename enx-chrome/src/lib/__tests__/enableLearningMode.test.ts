import {
  disableLearningModeOnTab,
  enableLearningModeOnTab,
  getLearningModeStatusOnTab,
} from '@/lib/enableLearningMode'

const noReceiverError = () =>
  new Error('Could not establish connection. Receiving end does not exist.')

describe('enableLearningModeOnTab', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    ;(chrome.runtime.getManifest as jest.Mock).mockReturnValue({
      content_scripts: [{ js: ['assets/content.tsx-loader-abc123.js'] }],
    })
  })

  it('sends enxRun directly when the content script is already listening', async () => {
    ;(chrome.tabs.sendMessage as jest.Mock).mockResolvedValue({ success: true })

    const result = await enableLearningModeOnTab(7)

    expect(result).toEqual({ success: true })
    expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(1)
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(7, {
      action: 'enxRun',
    })
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled()
  })

  it('injects the content script and retries when nothing is listening yet', async () => {
    ;(chrome.tabs.sendMessage as jest.Mock)
      .mockRejectedValueOnce(
        new Error(
          'Could not establish connection. Receiving end does not exist.'
        )
      )
      .mockResolvedValueOnce({ success: true })
    ;(chrome.scripting.executeScript as jest.Mock).mockResolvedValue(undefined)

    const result = await enableLearningModeOnTab(7)

    expect(result).toEqual({ success: true })
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 7 },
      files: ['assets/content.tsx-loader-abc123.js'],
    })
    expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(2)
  })

  it('retries past the loader-vs-listener race instead of surfacing the raw no-receiver error', async () => {
    // The injected file is CRXJS's loader IIFE: it kicks off an async
    // import() of the real bundle and resolves immediately, before that
    // import (and the addListener call inside it) has finished. The retry
    // right after executeScript() can still hit "no receiver" once or
    // twice before the real script is actually listening.
    ;(chrome.tabs.sendMessage as jest.Mock)
      .mockRejectedValueOnce(noReceiverError()) // pre-injection probe
      .mockRejectedValueOnce(noReceiverError()) // first retry: loader still importing
      .mockRejectedValueOnce(noReceiverError()) // second retry: still importing
      .mockResolvedValueOnce({ success: true }) // third retry: listener is up
    ;(chrome.scripting.executeScript as jest.Mock).mockResolvedValue(undefined)

    jest.useFakeTimers()
    try {
      const resultPromise = enableLearningModeOnTab(7)
      await jest.runAllTimersAsync()
      const result = await resultPromise

      expect(result).toEqual({ success: true })
      expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(4)
    } finally {
      jest.useRealTimers()
    }
  })

  it('gives up with a clean error, not the raw browser message, once retries are exhausted', async () => {
    ;(chrome.tabs.sendMessage as jest.Mock).mockRejectedValue(noReceiverError())
    ;(chrome.scripting.executeScript as jest.Mock).mockResolvedValue(undefined)

    jest.useFakeTimers()
    try {
      const resultPromise = enableLearningModeOnTab(7)
      await jest.runAllTimersAsync()
      const result = await resultPromise

      expect(result).toEqual({
        success: false,
        reason: 'error',
        error: 'Something went wrong while processing this page.',
      })
    } finally {
      jest.useRealTimers()
    }
  })

  it('reports injection-blocked when the browser refuses to script the page', async () => {
    ;(chrome.tabs.sendMessage as jest.Mock).mockRejectedValueOnce(
      new Error('Could not establish connection. Receiving end does not exist.')
    )
    const browserError = new Error('Cannot access a chrome:// URL')
    ;(chrome.scripting.executeScript as jest.Mock).mockRejectedValue(
      browserError
    )
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      const result = await enableLearningModeOnTab(7)

      expect(result).toEqual({
        success: false,
        reason: 'injection-blocked',
        error: "Catglish can't run on this page.",
      })
      expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(1)
      // The popup shows only the generic line; the browser's own reason
      // must reach the console so the cause can be diagnosed.
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('injection blocked on tab 7'),
        browserError
      )
    } finally {
      warn.mockRestore()
    }
  })
})

describe('getLearningModeStatusOnTab', () => {
  beforeEach(() => {
    jest.resetAllMocks()
  })

  it("asks the tab's top frame and returns its status", async () => {
    ;(chrome.tabs.sendMessage as jest.Mock).mockResolvedValue({
      status: { status: 'ready' },
    })

    const result = await getLearningModeStatusOnTab(7)

    expect(result).toEqual({ status: 'ready' })
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      7,
      { action: 'getLearningModeStatus' },
      { frameId: 0 }
    )
  })

  it('treats a tab with no content script as off, without injecting one', async () => {
    ;(chrome.tabs.sendMessage as jest.Mock).mockRejectedValue(noReceiverError())

    expect(await getLearningModeStatusOnTab(7)).toEqual({ status: 'off' })
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled()
  })

  it('treats a content script that does not know the action as off', async () => {
    ;(chrome.tabs.sendMessage as jest.Mock).mockResolvedValue({
      success: false,
      error: 'Unknown action',
    })

    expect(await getLearningModeStatusOnTab(7)).toEqual({ status: 'off' })
  })
})

describe('disableLearningModeOnTab', () => {
  beforeEach(() => {
    jest.resetAllMocks()
  })

  it('sends enxStop to every frame of the tab, as enxRun reaches them', async () => {
    ;(chrome.tabs.sendMessage as jest.Mock).mockResolvedValue({ success: true })

    await disableLearningModeOnTab(7)

    expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(1)
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(7, {
      action: 'enxStop',
    })
  })

  it('treats a tab with no content script as already off, without injecting one', async () => {
    ;(chrome.tabs.sendMessage as jest.Mock).mockRejectedValue(noReceiverError())

    await expect(disableLearningModeOnTab(7)).resolves.toBeUndefined()
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled()
  })

  it('passes any other messaging failure on to the caller', async () => {
    ;(chrome.tabs.sendMessage as jest.Mock).mockRejectedValue(
      new Error('No tab with id: 7')
    )

    await expect(disableLearningModeOnTab(7)).rejects.toThrow(
      'No tab with id: 7'
    )
  })
})
