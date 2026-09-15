import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import ReaderPage from '../page'
import { MAX_CONTENT_LENGTH } from '../constants'
import { apiService } from '@/services/api'

jest.mock('@/services/api', () => ({
  apiService: { createReaderDocument: jest.fn() },
}))

const mockCreateReaderDocument =
  apiService.createReaderDocument as jest.Mock

beforeEach(() => {
  ;(global as unknown as { chrome?: unknown }).chrome = undefined
  document.documentElement.removeAttribute('data-enx-extension')
  mockCreateReaderDocument.mockReset()
  mockCreateReaderDocument.mockResolvedValue({ success: true, data: { id: 'doc-1' } })
  sessionStorage.clear()
})

function paste(text: string) {
  fireEvent.change(screen.getByLabelText(/paste english text/i), {
    target: { value: text },
  })
}

// Submitting always kicks off an apiService.createReaderDocument() call
// (ADR-022); wrapping in act() flushes that microtask so its state update
// doesn't leak past the test as an "update not wrapped in act" warning.
async function clickRead() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Read' }))
  })
}

it('disables the Read button until text is entered', () => {
  render(<ReaderPage />)

  const button = screen.getByRole('button', { name: 'Read' })
  expect(button).toBeDisabled()

  paste('Hello world.')
  expect(button).toBeEnabled()
})

it('renders the pasted text as paragraphs split on blank lines', async () => {
  render(<ReaderPage />)
  paste('First paragraph.\n\nSecond paragraph.')
  await clickRead()

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

it('returns to the editor with the text intact via Edit', async () => {
  render(<ReaderPage />)
  paste('Keep me.')
  await clickRead()

  fireEvent.click(screen.getByRole('button', { name: 'Edit text' }))

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

  it('notifies the extension once the article is rendered, not before', async () => {
    render(<ReaderPage />)
    paste('Some text.')
    expect(enableCalls()).toHaveLength(0)

    await clickRead()

    expect(enableCalls()).toHaveLength(1)
    expect(enableCalls()[0][0]).toBe('test-ext-id')
  })

  it('re-notifies the extension when the same text is re-submitted after an edit', async () => {
    render(<ReaderPage />)
    paste('One.')
    await clickRead()
    fireEvent.click(screen.getByRole('button', { name: 'Edit text' }))
    await clickRead()

    expect(enableCalls()).toHaveLength(2)
  })
})

describe('extension install prompt', () => {
  const read = async () => {
    paste('Read me please.')
    await clickRead()
  }

  it('prompts to install the extension in the reading view when it is absent', async () => {
    process.env.NEXT_PUBLIC_ENX_EXTENSION_WEB_STORE_URL =
      'https://chromewebstore.google.com/detail/enx'
    ;(global as unknown as { chrome?: unknown }).chrome = undefined

    render(<ReaderPage />)
    await read()

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
    await read()

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
    await read()

    fireEvent.click(await screen.findByRole('button', { name: /dismiss/i }))

    expect(screen.queryByRole('link', { name: /install/i })).not.toBeInTheDocument()
  })
})

describe('persistence (ADR-022)', () => {
  it('links to the "My Documents" history page', () => {
    render(<ReaderPage />)
    expect(screen.getByRole('link', { name: 'My Documents' })).toHaveAttribute(
      'href',
      '/reader/history'
    )
  })

  it('disables Read when pasted text exceeds the character limit', () => {
    render(<ReaderPage />)

    paste('x'.repeat(MAX_CONTENT_LENGTH + 1))

    expect(screen.getByRole('button', { name: 'Read' })).toBeDisabled()
  })

  it('saves the article on submit and shows a saved indicator', async () => {
    render(<ReaderPage />)
    paste('Save me.')

    await clickRead()

    expect(mockCreateReaderDocument).toHaveBeenCalledWith('Save me.')
    expect(await screen.findByText(/saved/i)).toBeInTheDocument()
  })

  it('shows a non-blocking note when saving fails', async () => {
    mockCreateReaderDocument.mockResolvedValue({
      success: false,
      error: 'network error',
    })

    render(<ReaderPage />)
    paste('Still readable.')

    await clickRead()

    expect(await screen.findByText(/couldn.t save/i)).toBeInTheDocument()
    // The reading view itself is unaffected by the save failure.
    expect(document.querySelector('#enx-reader-article')).toHaveTextContent(
      'Still readable.'
    )
  })

  it('opens a saved document from the history handoff without re-saving it', () => {
    sessionStorage.setItem(
      'enx-reader-open-doc',
      JSON.stringify({ content: 'From history.' })
    )

    render(<ReaderPage />)

    expect(document.querySelector('#enx-reader-article')).toHaveTextContent(
      'From history.'
    )
    expect(mockCreateReaderDocument).not.toHaveBeenCalled()
    expect(sessionStorage.getItem('enx-reader-open-doc')).toBeNull()
  })
})
