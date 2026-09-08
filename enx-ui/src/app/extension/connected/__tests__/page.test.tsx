import { act, render, screen } from '@testing-library/react'
import ExtensionConnectedPage from '../page'

beforeEach(() => {
  process.env.NEXT_PUBLIC_ENX_EXTENSION_ID = 'test-ext-id'
  ;(global as unknown as { chrome?: unknown }).chrome = undefined
})

it('tells the extension the sign-in is done on mount', () => {
  const sendMessage = jest.fn()
  ;(global as unknown as { chrome?: unknown }).chrome = {
    runtime: { sendMessage },
  }

  render(<ExtensionConnectedPage />)

  expect(sendMessage).toHaveBeenCalledWith(
    'test-ext-id',
    { type: 'enx:signed-in' },
    expect.any(Function)
  )
})

it('renders a fallback message for when the tab is not closed automatically', () => {
  render(<ExtensionConnectedPage />)

  expect(screen.getByRole('heading', { name: /signed in/i })).toBeInTheDocument()
  expect(screen.getByText(/close it and return to your page/i)).toBeInTheDocument()
})

it('renders without an extension present (a plain web visitor)', () => {
  expect(() => render(<ExtensionConnectedPage />)).not.toThrow()
})

it('counts the return delay down and then drops the seconds', () => {
  jest.useFakeTimers()
  try {
    render(<ExtensionConnectedPage />)

    expect(screen.getByText(/in 3s/i)).toBeInTheDocument()

    act(() => {
      jest.advanceTimersByTime(1000)
    })
    expect(screen.getByText(/in 2s/i)).toBeInTheDocument()

    act(() => {
      jest.advanceTimersByTime(3000)
    })
    expect(screen.queryByText(/in \d+s/i)).not.toBeInTheDocument()
    expect(
      screen.getByText(/taking you back to what you were reading/i)
    ).toBeInTheDocument()
  } finally {
    jest.useRealTimers()
  }
})
