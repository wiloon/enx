import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ReaderPage from '../page'

beforeEach(() => {
  ;(global as unknown as { chrome?: unknown }).chrome = undefined
  document.documentElement.removeAttribute('data-enx-extension')
})

function paste(text: string) {
  fireEvent.change(screen.getByLabelText(/paste english text/i), {
    target: { value: text },
  })
}

it('disables the Read button until text is entered', () => {
  render(<ReaderPage />)

  const button = screen.getByRole('button', { name: 'Read' })
  expect(button).toBeDisabled()

  paste('Hello world.')
  expect(button).toBeEnabled()
})

it('renders the pasted text as paragraphs split on blank lines', () => {
  render(<ReaderPage />)
  paste('First paragraph.\n\nSecond paragraph.')
  fireEvent.click(screen.getByRole('button', { name: 'Read' }))

  const article = document.querySelector('#enx-reader-article')
  expect(article).toBeInTheDocument()

  const paragraphs = article!.querySelectorAll('p')
  expect(paragraphs).toHaveLength(2)
  expect(paragraphs[0]).toHaveTextContent('First paragraph.')
  expect(paragraphs[1]).toHaveTextContent('Second paragraph.')

  // The editor is replaced by the reading view.
  expect(
    screen.queryByRole('button', { name: 'Read' })
  ).not.toBeInTheDocument()
})

it('returns to the editor with the text intact via Edit', () => {
  render(<ReaderPage />)
  paste('Keep me.')
  fireEvent.click(screen.getByRole('button', { name: 'Read' }))

  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

  expect(screen.getByLabelText(/paste english text/i)).toHaveValue('Keep me.')
})

describe('enabling learning mode via the extension', () => {
  let sendMessage: jest.Mock

  beforeEach(() => {
    process.env.NEXT_PUBLIC_ENX_EXTENSION_ID = 'test-ext-id'
    sendMessage = jest.fn()
    ;(global as unknown as { chrome?: unknown }).chrome = { runtime: { sendMessage } }
  })

  const enableCalls = () =>
    sendMessage.mock.calls.filter(
      ([, message]) => (message as { type?: string })?.type === 'enx:enable-reader'
    )

  it('notifies the extension once the article is rendered, not before', () => {
    render(<ReaderPage />)
    paste('Some text.')
    expect(enableCalls()).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'Read' }))

    expect(enableCalls()).toHaveLength(1)
    expect(enableCalls()[0][0]).toBe('test-ext-id')
  })

  it('re-notifies the extension when the same text is re-submitted after an edit', () => {
    render(<ReaderPage />)
    paste('One.')
    fireEvent.click(screen.getByRole('button', { name: 'Read' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Read' }))

    expect(enableCalls()).toHaveLength(2)
  })
})

describe('extension install prompt', () => {
  const read = () => {
    paste('Read me please.')
    fireEvent.click(screen.getByRole('button', { name: 'Read' }))
  }

  it('prompts to install the extension in the reading view when it is absent', async () => {
    process.env.NEXT_PUBLIC_ENX_EXTENSION_WEB_STORE_URL =
      'https://chromewebstore.google.com/detail/enx'
    ;(global as unknown as { chrome?: unknown }).chrome = undefined

    render(<ReaderPage />)
    read()

    const link = await screen.findByRole('link', { name: /install/i })
    expect(link).toHaveAttribute(
      'href',
      'https://chromewebstore.google.com/detail/enx'
    )
  })

  it('does not prompt when the extension is installed', async () => {
    process.env.NEXT_PUBLIC_ENX_EXTENSION_ID = 'test-ext-id'
    ;(global as unknown as { chrome?: unknown }).chrome = {
      runtime: { sendMessage: jest.fn((_id, _m, cb) => cb({ ok: true, version: '1' })) },
    }

    render(<ReaderPage />)
    read()

    await waitFor(() =>
      expect(document.querySelector('#enx-reader-article')).toBeInTheDocument()
    )
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: /install/i })).not.toBeInTheDocument()
    )
  })

  it('can be dismissed', async () => {
    ;(global as unknown as { chrome?: unknown }).chrome = undefined

    render(<ReaderPage />)
    read()

    fireEvent.click(await screen.findByRole('button', { name: /dismiss/i }))

    expect(screen.queryByRole('link', { name: /install/i })).not.toBeInTheDocument()
  })
})
