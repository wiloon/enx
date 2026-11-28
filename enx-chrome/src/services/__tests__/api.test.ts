import { sendMessageToBackground } from '@/services/api'

type Reply = (response?: unknown) => void

const runtime = chrome.runtime as unknown as {
  sendMessage: jest.Mock
  lastError?: { message?: string }
}

describe('sendMessageToBackground', () => {
  beforeEach(() => {
    runtime.sendMessage.mockReset()
    delete runtime.lastError
  })

  afterEach(() => {
    delete runtime.lastError
  })

  it("sends the message as given and resolves with the background's reply", async () => {
    runtime.sendMessage.mockImplementation((_message: unknown, reply: Reply) =>
      reply({ success: true, data: { id: 1 } })
    )

    await expect(
      sendMessageToBackground({ type: 'getPreferences' })
    ).resolves.toEqual({ success: true, data: { id: 1 } })
    expect(runtime.sendMessage).toHaveBeenCalledTimes(1)
    expect(runtime.sendMessage.mock.calls[0][0]).toEqual({
      type: 'getPreferences',
    })
  })

  it('resolves with undefined when the background sends no reply', async () => {
    runtime.sendMessage.mockImplementation((_message: unknown, reply: Reply) =>
      reply()
    )

    await expect(
      sendMessageToBackground({ type: 'getPreferences' })
    ).resolves.toBeUndefined()
  })

  it("rejects with the browser's message when the send fails", async () => {
    runtime.sendMessage.mockImplementation(
      (_message: unknown, reply: Reply) => {
        runtime.lastError = {
          message:
            'Could not establish connection. Receiving end does not exist.',
        }
        reply()
      }
    )

    await expect(
      sendMessageToBackground({ type: 'getPreferences' })
    ).rejects.toThrow(
      'Could not establish connection. Receiving end does not exist.'
    )
  })
})
