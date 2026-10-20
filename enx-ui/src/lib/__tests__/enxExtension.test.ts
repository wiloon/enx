import {
  detectExtension,
  extensionStatus,
  isChromium,
  notifySignedIn,
} from '../enxExtension'
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

describe('extensionStatus (ADR-047 Decision 4)', () => {
  it('reports the extension and whether its icon is pinned', async () => {
    const sendMessage = jest.fn((_id, _msg, cb) =>
      cb({ ok: true, version: '2.0.0', isOnToolbar: true })
    )
    installChrome(sendMessage)

    await expect(extensionStatus()).resolves.toEqual({
      installed: true,
      version: '2.0.0',
      isOnToolbar: true,
    })
    expect(sendMessage).toHaveBeenCalledWith(
      'test-ext-id',
      { type: 'enx:status' },
      expect.any(Function)
    )
  })

  it('reports not installed when the extension never answers (timeout)', async () => {
    jest.useFakeTimers()
    try {
      installChrome(jest.fn())

      const result = extensionStatus(1000)
      jest.advanceTimersByTime(1000)

      await expect(result).resolves.toEqual({
        installed: false,
        isOnToolbar: false,
      })
    } finally {
      jest.useRealTimers()
    }
  })

  it('reports not installed without a messaging bridge', async () => {
    await expect(extensionStatus()).resolves.toEqual({
      installed: false,
      isOnToolbar: false,
    })
  })
})

describe('isChromium', () => {
  it('tells Chrome and Edge from Firefox and Safari by user agent', () => {
    expect(
      isChromium(
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
      )
    ).toBe(true)
    expect(
      isChromium(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0'
      )
    ).toBe(true)
    expect(
      isChromium(
        'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0'
      )
    ).toBe(false)
    expect(
      isChromium(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
      )
    ).toBe(false)
  })
})

describe('detectExtension', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-enx-extension')
  })

  it('reads the version off the content-script stamp without pinging', async () => {
    document.documentElement.dataset.enxExtension = '1.0.1'
    const sendMessage = jest.fn()
    installChrome(sendMessage)

    await expect(detectExtension()).resolves.toEqual({
      installed: true,
      version: '1.0.1',
    })
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('falls back to the ping and passes its version through', async () => {
    installChrome(
      jest.fn((_id, _msg, cb) => cb({ ok: true, version: '1.0.2' }))
    )

    await expect(detectExtension()).resolves.toEqual({
      installed: true,
      version: '1.0.2',
    })
  })
})
