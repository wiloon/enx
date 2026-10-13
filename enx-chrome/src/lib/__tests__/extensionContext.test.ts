import {
  EXTENSION_UPDATED_MESSAGE,
  LOOKUP_FAILED_MESSAGE,
  isExtensionContextInvalidated,
  sendRuntimeMessage,
} from '@/lib/extensionContext'

type Callback = (response?: unknown) => void

const runtime = (
  sendMessage: (message: unknown, callback: Callback) => void,
  overrides: { id?: string; lastError?: { message?: string } } = {}
) =>
  ({
    id: 'id' in overrides ? overrides.id : 'catglish',
    lastError: overrides.lastError,
    sendMessage: jest.fn(sendMessage),
  }) as unknown as typeof chrome.runtime

const extensionUpdated = {
  success: false,
  error: EXTENSION_UPDATED_MESSAGE,
  extensionUpdated: true,
}

describe('isExtensionContextInvalidated', () => {
  it("recognises Chrome's error, as an Error or a string", () => {
    expect(
      isExtensionContextInvalidated(new Error('Extension context invalidated.'))
    ).toBe(true)
    expect(
      isExtensionContextInvalidated('Extension context invalidated.')
    ).toBe(true)
    expect(isExtensionContextInvalidated(new Error('Failed to fetch'))).toBe(
      false
    )
    expect(isExtensionContextInvalidated(undefined)).toBe(false)
  })
})

describe('sendRuntimeMessage', () => {
  it('passes the background answer through', async () => {
    const answer = { success: true, ecp: { English: 'hello' } }
    const rt = runtime((_m, cb) => cb(answer))

    expect(await sendRuntimeMessage({ type: 'getOneWord' }, rt)).toBe(answer)
    expect(rt.sendMessage).toHaveBeenCalledWith(
      { type: 'getOneWord' },
      expect.any(Function)
    )
  })

  // The bug: a tab opened before an extension reload kept its old script;
  // sendMessage threw, and the popup blamed the user's internet connection.
  it('says the extension was updated when sendMessage throws invalidated', async () => {
    const rt = runtime(() => {
      throw new Error('Extension context invalidated.')
    })

    expect(await sendRuntimeMessage({ type: 'getOneWord' }, rt)).toEqual(
      extensionUpdated
    )
  })

  it('says the extension was updated when the runtime has lost its id', async () => {
    const rt = runtime(() => {}, { id: undefined })

    expect(await sendRuntimeMessage({ type: 'getOneWord' }, rt)).toEqual(
      extensionUpdated
    )
    expect(rt.sendMessage).not.toHaveBeenCalled()
  })

  it('says the extension was updated when lastError reports invalidated', async () => {
    const rt = runtime((_m, cb) => cb(undefined), {
      lastError: { message: 'Extension context invalidated.' },
    })

    expect(await sendRuntimeMessage({ type: 'getOneWord' }, rt)).toEqual(
      extensionUpdated
    )
  })

  it('keeps "No response" when the background just did not answer', async () => {
    const rt = runtime((_m, cb) => cb(undefined), {
      lastError: {
        message: 'The message port closed before a response was received.',
      },
    })

    expect(await sendRuntimeMessage({ type: 'getOneWord' }, rt)).toEqual({
      success: false,
      error: 'No response',
    })
  })

  it('never blames the network for any other throw', async () => {
    const rt = runtime(() => {
      throw new Error('boom')
    })

    expect(await sendRuntimeMessage({ type: 'getOneWord' }, rt)).toEqual({
      success: false,
      error: LOOKUP_FAILED_MESSAGE,
    })
  })
})
