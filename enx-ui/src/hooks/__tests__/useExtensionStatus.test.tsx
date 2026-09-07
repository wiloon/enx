import { act, renderHook, waitFor } from '@testing-library/react'
import { useExtensionStatus } from '../useExtensionStatus'

type SendMessage = jest.Mock

function installChrome(sendMessage?: SendMessage, lastError?: unknown) {
  ;(global as unknown as { chrome?: unknown }).chrome = sendMessage
    ? { runtime: { sendMessage, lastError } }
    : undefined
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_ENX_EXTENSION_ID = 'test-ext-id'
  installChrome(undefined)
  document.documentElement.removeAttribute('data-enx-extension')
})

it('reports not-installed when the page has no extension messaging bridge', async () => {
  const { result } = renderHook(() => useExtensionStatus())
  await waitFor(() => expect(result.current).toBe('not-installed'))
})

it('reports installed when the extension answers the ping', async () => {
  const sendMessage = jest.fn((_id, _msg, cb) => cb({ ok: true, version: '1.2.3' }))
  installChrome(sendMessage)

  const { result } = renderHook(() => useExtensionStatus())

  await waitFor(() => expect(result.current).toBe('installed'))
  expect(sendMessage).toHaveBeenCalledWith(
    'test-ext-id',
    { type: 'enx:ping' },
    expect.any(Function)
  )
})

it('reports not-installed when the ping call reports a runtime lastError', async () => {
  const sendMessage = jest.fn((_id, _msg, cb) => cb(undefined))
  installChrome(sendMessage, { message: 'Could not establish connection.' })

  const { result } = renderHook(() => useExtensionStatus())

  await waitFor(() => expect(result.current).toBe('not-installed'))
})

it('reports not-installed when the ping never comes back', async () => {
  jest.useFakeTimers()
  installChrome(jest.fn()) // callback is never invoked

  const { result } = renderHook(() => useExtensionStatus())
  await act(async () => {
    jest.advanceTimersByTime(2000)
  })

  expect(result.current).toBe('not-installed')
  jest.useRealTimers()
})

it('trusts the content-script stamp on <html> without waiting for the ping', async () => {
  document.documentElement.dataset.enxExtension = '1.2.3'
  installChrome(jest.fn()) // ping never answers

  const { result } = renderHook(() => useExtensionStatus())

  await waitFor(() => expect(result.current).toBe('installed'))
})
