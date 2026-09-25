import { notifySignedIn } from '../enxExtension'
import { setRuntimeEnv } from '@/test/runtimeEnv'

type SendMessage = jest.Mock

function installChrome(sendMessage?: SendMessage, lastError?: unknown) {
  ;(global as unknown as { chrome?: unknown }).chrome = sendMessage
    ? { runtime: { sendMessage, lastError } }
    : undefined
}

beforeEach(() => {
  setRuntimeEnv({ ENX_EXTENSION_ID: 'test-ext-id' })
  installChrome(undefined)
})

describe('notifySignedIn (ADR-020)', () => {
  it('posts enx:signed-in to the extension', () => {
    const sendMessage = jest.fn()
    installChrome(sendMessage)

    notifySignedIn()

    expect(sendMessage).toHaveBeenCalledWith(
      'test-ext-id',
      { type: 'enx:signed-in' },
      expect.any(Function)
    )
  })

  it('resolves with the extension response', async () => {
    const sendMessage = jest.fn((_id, _msg, callback) =>
      callback({ ok: true, returned: true })
    )
    installChrome(sendMessage)

    await expect(notifySignedIn()).resolves.toEqual({
      ok: true,
      returned: true,
    })
  })

  it('resolves null when there is no extension messaging bridge', async () => {
    await expect(notifySignedIn()).resolves.toBeNull()
  })

  it('resolves null when the extension id is not configured', async () => {
    setRuntimeEnv({ ENX_EXTENSION_ID: '' })
    const sendMessage = jest.fn()
    installChrome(sendMessage)

    await expect(notifySignedIn()).resolves.toBeNull()
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('resolves null when sendMessage throws', async () => {
    const sendMessage = jest.fn(() => {
      throw new Error('extension context invalidated')
    })
    installChrome(sendMessage)

    await expect(notifySignedIn()).resolves.toBeNull()
  })

  it('resolves null when the callback never fires (timeout)', async () => {
    jest.useFakeTimers()
    try {
      const sendMessage = jest.fn()
      installChrome(sendMessage)

      const result = notifySignedIn(1000)
      jest.advanceTimersByTime(1000)

      await expect(result).resolves.toBeNull()
    } finally {
      jest.useRealTimers()
    }
  })
})
