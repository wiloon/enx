import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ReaderPage from '../page'
import { MAX_CONTENT_LENGTH } from '../constants'
import { apiService } from '@/services/api'
import { setRuntimeEnv } from '@/test/runtimeEnv'

jest.mock('@/services/api', () => ({
  apiService: {
    createReaderDocument: jest.fn(),
    updateReaderDocument: jest.fn(),
    listReaderDocuments: jest.fn(),
    getReaderDocument: jest.fn(),
  },
}))

const mockCreateReaderDocument = apiService.createReaderDocument as jest.Mock
const mockUpdateReaderDocument = apiService.updateReaderDocument as jest.Mock
const mockListReaderDocuments = apiService.listReaderDocuments as jest.Mock
const mockGetReaderDocument = apiService.getReaderDocument as jest.Mock

beforeEach(() => {
  ;(global as unknown as { chrome?: unknown }).chrome = undefined
  document.documentElement.removeAttribute('data-enx-extension')
  mockCreateReaderDocument.mockReset()
  mockCreateReaderDocument.mockResolvedValue({
    success: true,
    data: { id: 'doc-1' },
  })
  mockUpdateReaderDocument.mockReset()
  mockUpdateReaderDocument.mockResolvedValue({
    success: true,
    data: { id: 'doc-1' },
  })
  mockListReaderDocuments.mockReset()
  mockListReaderDocuments.mockResolvedValue({
    success: true,
    data: { documents: [] },
  })
  mockGetReaderDocument.mockReset()
  sessionStorage.clear()
  localStorage.clear()
})

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ReaderPage />
    </QueryClientProvider>
  )
}

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
    fireEvent.click(screen.getByRole('button', { name: 'Start reading' }))
  })
}

// On mount the page asks whether the extension is installed, and the answer
// lands after render. Without the extension, the editor ends up warning that
// Reader needs it and the reading view offers to install it.
const editorSettled = () =>
  screen.findByText(/Reader needs the Catglish Chrome extension/)
const readingViewSettled = () =>
  screen.findByRole('button', { name: 'Dismiss' })

it('disables the Start reading button until text is entered', async () => {
  renderPage()
  await editorSettled()

  const button = screen.getByRole('button', { name: 'Start reading' })
  expect(button).toBeDisabled()

  paste('Hello world.')
  expect(button).toBeEnabled()
})

it('renders the pasted text as paragraphs split on blank lines', async () => {
  renderPage()
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
    screen.queryByRole('button', { name: 'Start reading' })
  ).not.toBeInTheDocument()
})

it('returns to the editor with the text intact via Edit', async () => {
  renderPage()
  paste('Keep me.')
  await clickRead()

  fireEvent.click(screen.getByRole('button', { name: 'Edit text' }))

  expect(screen.getByLabelText(/paste english text/i)).toHaveValue('Keep me.')
})

describe('enabling learning mode via the extension', () => {
  let sendMessage: jest.Mock

  beforeEach(() => {
    setRuntimeEnv({ ENX_EXTENSION_ID: 'test-ext-id' })
    sendMessage = jest.fn()
    ;(global as unknown as { chrome?: unknown }).chrome = {
      runtime: { sendMessage },
    }
  })

  const enableCalls = () =>
    sendMessage.mock.calls.filter(
      ([, message]) =>
        (message as { type?: string })?.type === 'enx:enable-reader'
    )

  it('notifies the extension once the article is rendered, not before', async () => {
    renderPage()
    paste('Some text.')
    expect(enableCalls()).toHaveLength(0)

    await clickRead()

    expect(enableCalls()).toHaveLength(1)
    expect(enableCalls()[0][0]).toBe('test-ext-id')
  })

  it('re-notifies the extension when the same text is re-submitted after an edit', async () => {
    renderPage()
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
    setRuntimeEnv({
      ENX_EXTENSION_WEB_STORE_URL:
        'https://chromewebstore.google.com/detail/enx',
    })
    ;(global as unknown as { chrome?: unknown }).chrome = undefined

    renderPage()
    await read()

    const link = await screen.findByRole('link', { name: /install/i })
    expect(link).toHaveAttribute(
      'href',
      'https://chromewebstore.google.com/detail/enx'
    )
  })

  it('does not prompt when the extension is installed', async () => {
    setRuntimeEnv({ ENX_EXTENSION_ID: 'test-ext-id' })
    ;(global as unknown as { chrome?: unknown }).chrome = {
      runtime: {
        sendMessage: jest.fn((_id, _m, cb) => cb({ ok: true, version: '1' })),
      },
    }

    renderPage()
    await read()

    await waitFor(() =>
      expect(document.querySelector('#enx-reader-article')).toBeInTheDocument()
    )
    await waitFor(() =>
      expect(
        screen.queryByRole('link', { name: /install/i })
      ).not.toBeInTheDocument()
    )
  })

  it('can be dismissed', async () => {
    ;(global as unknown as { chrome?: unknown }).chrome = undefined

    renderPage()
    await read()

    fireEvent.click(await screen.findByRole('button', { name: /dismiss/i }))

    expect(
      screen.queryByRole('link', { name: /install/i })
    ).not.toBeInTheDocument()
  })
})

describe('persistence (ADR-022)', () => {
  it('disables Start reading when pasted text exceeds the character limit', async () => {
    renderPage()
    await editorSettled()

    paste('x'.repeat(MAX_CONTENT_LENGTH + 1))

    expect(screen.getByRole('button', { name: 'Start reading' })).toBeDisabled()
  })

  it('saves the article on submit and shows a saved indicator', async () => {
    renderPage()
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

    renderPage()
    paste('Still readable.')

    await clickRead()

    expect(await screen.findByText(/couldn.t save/i)).toBeInTheDocument()
    // The reading view itself is unaffected by the save failure.
    expect(document.querySelector('#enx-reader-article')).toHaveTextContent(
      'Still readable.'
    )
  })

  it('opens a saved document from the history handoff without re-saving it', async () => {
    sessionStorage.setItem(
      'enx-reader-open-doc',
      JSON.stringify({ content: 'From history.' })
    )

    renderPage()
    await readingViewSettled()

    expect(document.querySelector('#enx-reader-article')).toHaveTextContent(
      'From history.'
    )
    expect(mockCreateReaderDocument).not.toHaveBeenCalled()
    expect(sessionStorage.getItem('enx-reader-open-doc')).toBeNull()
  })

  it('editing and re-reading a just-created document updates it instead of creating a second one', async () => {
    renderPage()
    paste('First version.')
    await clickRead()
    expect(mockCreateReaderDocument).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Edit text' }))
    paste('Revised version.')
    await clickRead()

    expect(mockCreateReaderDocument).toHaveBeenCalledTimes(1)
    expect(mockUpdateReaderDocument).toHaveBeenCalledWith(
      'doc-1',
      'Revised version.'
    )
  })

  it('editing a document opened from history updates that same document', async () => {
    sessionStorage.setItem(
      'enx-reader-open-doc',
      JSON.stringify({ id: 'doc-from-history', content: 'Original.' })
    )
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Edit text' }))
    paste('Edited.')
    await clickRead()

    expect(mockCreateReaderDocument).not.toHaveBeenCalled()
    expect(mockUpdateReaderDocument).toHaveBeenCalledWith(
      'doc-from-history',
      'Edited.'
    )
  })

  it('"New" starts a genuinely separate document, not an update', async () => {
    renderPage()
    paste('First document.')
    await clickRead()
    expect(mockCreateReaderDocument).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'New' }))
    expect(screen.getByLabelText(/paste english text/i)).toHaveValue('')

    paste('Second document.')
    await clickRead()

    expect(mockCreateReaderDocument).toHaveBeenCalledTimes(2)
    expect(mockCreateReaderDocument).toHaveBeenLastCalledWith(
      'Second document.'
    )
    expect(mockUpdateReaderDocument).not.toHaveBeenCalled()
  })

  it('shows a "My Documents" link and a "New" button in reading mode too', async () => {
    renderPage()
    paste('Some text.')
    await clickRead()

    expect(
      screen.getAllByRole('link', { name: 'My Documents' })[0]
    ).toHaveAttribute('href', '/reader/history')
    expect(screen.getByRole('button', { name: 'New' })).toBeInTheDocument()
  })
})

describe('reading width', () => {
  function articleContainer() {
    return document.querySelector('#enx-reader-article')!.parentElement!
  }

  it('defaults to Medium (896px) for a first-time reader', async () => {
    renderPage()
    paste('Some text.')
    await clickRead()

    expect(screen.getByRole('radio', { name: 'Medium' })).toBeChecked()
    expect(articleContainer()).toHaveClass('max-w-4xl')
  })

  it('switches width and remembers the choice', async () => {
    renderPage()
    paste('Some text.')
    await clickRead()

    fireEvent.click(screen.getByRole('radio', { name: 'Full' }))

    expect(articleContainer()).toHaveClass('max-w-none')
    expect(articleContainer()).not.toHaveClass('max-w-4xl')
    expect(localStorage.getItem('enx.reader.width')).toBe('full')
  })

  it('restores the remembered width on the next visit', async () => {
    localStorage.setItem('enx.reader.width', 'wide')
    renderPage()
    paste('Some text.')
    await clickRead()

    expect(screen.getByRole('radio', { name: 'Wide' })).toBeChecked()
    expect(articleContainer()).toHaveClass('max-w-6xl')
  })

  it('ignores an unknown stored value', async () => {
    localStorage.setItem('enx.reader.width', 'huge')
    renderPage()
    paste('Some text.')
    await clickRead()

    expect(articleContainer()).toHaveClass('max-w-4xl')
  })

  it('keeps the paste editor at its own width', async () => {
    localStorage.setItem('enx.reader.width', 'full')
    renderPage()
    await editorSettled()

    expect(
      screen.getByLabelText(/paste english text/i).closest('.max-w-3xl')
    ).not.toBeNull()
  })
})

describe('landing page', () => {
  it('explains what Reader is for', async () => {
    renderPage()
    await editorSettled()
    expect(
      screen.getByRole('heading', { level: 1, name: 'Reader' })
    ).toBeInTheDocument()
    expect(screen.getByText(/an AI chat\s+reply, a PDF/)).toBeInTheDocument()
  })

  it('links to the sample article, and hides the link once there is text', async () => {
    renderPage()
    await editorSettled()
    expect(screen.getByRole('link', { name: 'Try a sample' })).toHaveAttribute(
      'href',
      '/reader/sample'
    )

    paste('Hello world.')
    expect(
      screen.queryByRole('link', { name: 'Try a sample' })
    ).not.toBeInTheDocument()
  })

  it('states the privacy terms instead of an empty counter', async () => {
    renderPage()
    await editorSettled()
    expect(
      screen.getByText(
        'Only you can see it. Deleted automatically after 7 days.'
      )
    ).toBeInTheDocument()
    expect(screen.queryByText(/characters/)).not.toBeInTheDocument()
  })

  it('shows the character count, with its unit, near the limit', async () => {
    renderPage()
    await editorSettled()
    paste('x'.repeat(MAX_CONTENT_LENGTH * 0.95))
    expect(
      screen.getByText(
        `${(MAX_CONTENT_LENGTH * 0.95).toLocaleString()} / ${MAX_CONTENT_LENGTH.toLocaleString()} characters`
      )
    ).toBeInTheDocument()
  })

  it('warns before reading that the extension is required when it is missing', async () => {
    setRuntimeEnv({
      ENX_EXTENSION_WEB_STORE_URL:
        'https://chromewebstore.google.com/detail/enx',
    })
    renderPage()

    expect(
      await screen.findByText(/Reader needs the Catglish Chrome extension/)
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Install the extension' })
    ).toHaveAttribute('href', 'https://chromewebstore.google.com/detail/enx')
  })

  it('does not warn when the extension is installed', async () => {
    setRuntimeEnv({ ENX_EXTENSION_ID: 'test-ext-id' })
    const sendMessage = jest.fn((_id, _m, cb) => cb({ ok: true, version: '1' }))
    ;(global as unknown as { chrome?: unknown }).chrome = {
      runtime: { sendMessage },
    }
    renderPage()

    await waitFor(() => expect(sendMessage).toHaveBeenCalled())
    expect(
      screen.queryByText(/Reader needs the Catglish Chrome extension/)
    ).not.toBeInTheDocument()
  })
})

describe('recent documents', () => {
  const docs = [1, 2, 3, 4].map((n) => ({
    id: `doc-${n}`,
    createdAt: '2026-10-10T12:00:00Z',
    updatedAt: '2026-10-10T12:00:00Z',
    preview: `Preview ${n}`,
  }))

  it('lists the three newest with a link to all documents', async () => {
    mockListReaderDocuments.mockResolvedValue({
      success: true,
      data: { documents: docs },
    })
    renderPage()

    expect(await screen.findByText('Preview 1')).toBeInTheDocument()
    expect(screen.getByText('Preview 3')).toBeInTheDocument()
    expect(screen.queryByText('Preview 4')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View all' })).toHaveAttribute(
      'href',
      '/reader/history'
    )
  })

  it('hides the section when there are none', async () => {
    renderPage()
    await waitFor(() => expect(mockListReaderDocuments).toHaveBeenCalled())
    expect(screen.queryByText('Recent')).not.toBeInTheDocument()
  })

  it('opens a recent document without saving it again, and edits update it', async () => {
    mockListReaderDocuments.mockResolvedValue({
      success: true,
      data: { documents: docs },
    })
    mockGetReaderDocument.mockResolvedValue({
      success: true,
      data: { id: 'doc-2', content: 'Second document body.' },
    })
    renderPage()

    const preview = await screen.findByText('Preview 2')
    await act(async () => {
      fireEvent.click(preview)
    })

    expect(mockGetReaderDocument).toHaveBeenCalledWith('doc-2')
    expect(document.querySelector('#enx-reader-article')).toHaveTextContent(
      'Second document body.'
    )
    expect(mockCreateReaderDocument).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Edit text' }))
    paste('Edited body.')
    await clickRead()
    expect(mockUpdateReaderDocument).toHaveBeenCalledWith(
      'doc-2',
      'Edited body.'
    )
  })

  it('stays on the editor and shows the error when opening fails', async () => {
    mockListReaderDocuments.mockResolvedValue({
      success: true,
      data: { documents: docs },
    })
    mockGetReaderDocument.mockResolvedValue({
      success: false,
      error: 'document not found',
    })
    renderPage()

    const preview = await screen.findByText('Preview 1')
    await act(async () => {
      fireEvent.click(preview)
    })

    expect(await screen.findByText('document not found')).toBeInTheDocument()
    expect(screen.getByLabelText(/paste english text/i)).toBeInTheDocument()
  })
})
