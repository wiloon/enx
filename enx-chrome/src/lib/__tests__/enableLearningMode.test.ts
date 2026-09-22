import { enableLearningModeOnTab } from '@/lib/enableLearningMode'

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
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(7, { action: 'enxRun' })
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled()
  })

  it('injects the content script and retries when nothing is listening yet', async () => {
    ;(chrome.tabs.sendMessage as jest.Mock)
      .mockRejectedValueOnce(
        new Error('Could not establish connection. Receiving end does not exist.')
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

  it('reports injection-blocked when the browser refuses to script the page', async () => {
    ;(chrome.tabs.sendMessage as jest.Mock).mockRejectedValueOnce(
      new Error('Could not establish connection. Receiving end does not exist.')
    )
    ;(chrome.scripting.executeScript as jest.Mock).mockRejectedValue(
      new Error('Cannot access a chrome:// URL')
    )

    const result = await enableLearningModeOnTab(7)

    expect(result).toEqual({
      success: false,
      reason: 'injection-blocked',
      error: "Catglish can't run on this page.",
    })
    expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(1)
  })
})
