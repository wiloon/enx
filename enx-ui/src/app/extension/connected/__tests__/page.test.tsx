import { render, screen } from '@testing-library/react'
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
