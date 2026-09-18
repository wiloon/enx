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

  it('is a no-op when there is no extension messaging bridge', () => {
    expect(() => notifySignedIn()).not.toThrow()
  })

  it('is a no-op when the extension id is not configured', () => {
    setRuntimeEnv({ ENX_EXTENSION_ID: '' })
    const sendMessage = jest.fn()
    installChrome(sendMessage)

    notifySignedIn()

    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('swallows a throwing sendMessage', () => {
    const sendMessage = jest.fn(() => {
      throw new Error('extension context invalidated')
    })
    installChrome(sendMessage)

    expect(() => notifySignedIn()).not.toThrow()
  })
})
