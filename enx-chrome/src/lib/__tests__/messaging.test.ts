import { EXTENSION_UPDATED_MESSAGE } from '@/lib/extensionContext'
import {
  sendToBackground,
  sendToBackgroundFromPage,
  sendToTab,
} from '@/lib/messaging'

describe('sendToBackground', () => {
  it("sends the request as it is and resolves with the background's reply", async () => {
    const runtime = {
      sendMessage: jest.fn().mockResolvedValue({ access: 'anonymous' }),
    }

    await expect(
      sendToBackground({ type: 'learningAccess' }, runtime)
    ).resolves.toEqual({ access: 'anonymous' })
    expect(runtime.sendMessage.mock.calls).toEqual([
      [{ type: 'learningAccess' }],
    ])
  })

  it('keeps the key a message is sent under', async () => {
    const runtime = { sendMessage: jest.fn().mockResolvedValue(undefined) }

    await sendToBackground({ action: 'openWebSignIn' }, runtime)

    expect(runtime.sendMessage.mock.calls).toEqual([
      [{ action: 'openWebSignIn' }],
    ])
  })

  it('rejects when the background cannot be reached', async () => {
    const runtime = {
      sendMessage: jest
        .fn()
        .mockRejectedValue(new Error('Could not establish connection.')),
    }

    await expect(
      sendToBackground({ type: 'GET_POPUP_SUMMARY' }, runtime)
    ).rejects.toThrow('Could not establish connection.')
  })

  it('uses chrome.runtime when no runtime is given', async () => {
    const sendMessage = chrome.runtime.sendMessage as jest.Mock
    sendMessage.mockReset()
    sendMessage.mockResolvedValue({ success: true })

    await expect(
      sendToBackground({ type: 'openOptionsPage' })
    ).resolves.toEqual({ success: true })
    expect(sendMessage.mock.calls).toEqual([[{ type: 'openOptionsPage' }]])
  })
})

describe('sendToBackgroundFromPage', () => {
  type Reply = (response?: unknown) => void

  it("resolves with the background's reply", async () => {
    const runtime = {
      id: 'extension-id',
      lastError: undefined,
      sendMessage: jest.fn((_message: unknown, reply: Reply) =>
        reply({ success: true, autoEnable: true })
      ),
    }

    await expect(
      sendToBackgroundFromPage({ type: 'shouldAutoEnable' }, runtime as never)
    ).resolves.toEqual({ success: true, autoEnable: true })
    expect(runtime.sendMessage.mock.calls[0][0]).toEqual({
      type: 'shouldAutoEnable',
    })
  })

  it('never rejects: a script cut off by an update is told so', async () => {
    const runtime = {
      id: undefined,
      lastError: undefined,
      sendMessage: jest.fn(),
    }

    await expect(
      sendToBackgroundFromPage({ type: 'getReviewWords' }, runtime as never)
    ).resolves.toEqual({
      success: false,
      error: EXTENSION_UPDATED_MESSAGE,
      extensionUpdated: true,
    })
    expect(runtime.sendMessage).not.toHaveBeenCalled()
  })

  it('never rejects: no reply becomes a failed response', async () => {
    const runtime = {
      id: 'extension-id',
      lastError: undefined,
      sendMessage: jest.fn((_message: unknown, reply: Reply) => reply()),
    }

    await expect(
      sendToBackgroundFromPage({ type: 'getReviewWords' }, runtime as never)
    ).resolves.toEqual({ success: false, error: 'No response' })
  })
})

describe('sendToTab', () => {
  it('reaches every frame of the tab when no frame is named', async () => {
    const tabs = { sendMessage: jest.fn().mockResolvedValue({ success: true }) }

    await expect(
      sendToTab(7, { action: 'enxStop' }, undefined, tabs)
    ).resolves.toEqual({ success: true })
    expect(tabs.sendMessage.mock.calls).toEqual([[7, { action: 'enxStop' }]])
  })

  it('reaches only the named frame', async () => {
    const tabs = {
      sendMessage: jest.fn().mockResolvedValue({ status: { status: 'ready' } }),
    }

    await expect(
      sendToTab(7, { action: 'getLearningModeStatus' }, { frameId: 0 }, tabs)
    ).resolves.toEqual({ status: { status: 'ready' } })
    expect(tabs.sendMessage.mock.calls).toEqual([
      [7, { action: 'getLearningModeStatus' }, { frameId: 0 }],
    ])
  })

  it('rejects when nothing in the tab listens', async () => {
    const tabs = {
      sendMessage: jest
        .fn()
        .mockRejectedValue(
          new Error(
            'Could not establish connection. Receiving end does not exist.'
          )
        ),
    }

    await expect(
      sendToTab(7, { action: 'enxRun' }, undefined, tabs)
    ).rejects.toThrow('Receiving end does not exist')
  })
})
