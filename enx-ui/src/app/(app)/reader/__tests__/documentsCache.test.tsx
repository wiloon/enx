import { render, screen, fireEvent, act, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ReaderPage from '../page'
import ReaderHistoryPage from '../history/page'
import { apiService } from '@/services/api'

// After a save, the Recent list on /reader and My Documents show the saved
// document without a reload: both read the `reader-documents` query, which
// the app keeps for five minutes across client-side navigation (#572).

jest.mock('@/services/api', () => ({
  apiService: {
    createReaderDocument: jest.fn(),
    updateReaderDocument: jest.fn(),
    listReaderDocuments: jest.fn(),
    getReaderDocument: jest.fn(),
    deleteReaderDocument: jest.fn(),
  },
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}))

const mockCreate = apiService.createReaderDocument as jest.Mock
const mockUpdate = apiService.updateReaderDocument as jest.Mock
const mockList = apiService.listReaderDocuments as jest.Mock
const mockGet = apiService.getReaderDocument as jest.Mock

interface Row {
  id: string
  createdAt: string
  updatedAt: string
  preview: string
}

const OLD_DAY = '2026-10-01T12:00:00Z'
const NEW_DAY = '2026-10-29T12:00:00Z'

const existing: Row = {
  id: 'doc-old',
  createdAt: OLD_DAY,
  updatedAt: OLD_DAY,
  preview: 'An earlier note',
}
const other: Row = {
  id: 'doc-other',
  createdAt: '2026-10-05T12:00:00Z',
  updatedAt: '2026-10-05T12:00:00Z',
  preview: 'Another earlier note',
}
const created: Row = {
  id: 'doc-new',
  createdAt: NEW_DAY,
  updatedAt: NEW_DAY,
  preview: 'A freshly pasted note',
}

// What GET /api/reader/documents returns right now.
let serverDocs: Row[]

beforeEach(() => {
  ;(global as unknown as { chrome?: unknown }).chrome = undefined
  document.documentElement.removeAttribute('data-enx-extension')
  jest.clearAllMocks()
  sessionStorage.clear()
  localStorage.clear()
  serverDocs = [existing]
  mockList.mockImplementation(async () => ({
    success: true,
    data: { documents: serverDocs },
  }))
  mockCreate.mockImplementation(async () => {
    serverDocs = [created, ...serverDocs]
    return { success: true, data: { id: created.id } }
  })
})

// The production client keeps a list fresh for five minutes.
function newClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 5 * 60 * 1000, retry: false },
    },
  })
}

function mount(client: QueryClient, page: React.ReactElement) {
  return render(
    <QueryClientProvider client={client}>{page}</QueryClientProvider>
  )
}

function paste(text: string) {
  fireEvent.change(screen.getByLabelText(/paste english text/i), {
    target: { value: text },
  })
}

async function clickRead() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Start reading' }))
  })
}

const SAVED = 'Saved · kept for 7 days'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

// The preview buttons of a document list, in display order.
function rowsIn(container: HTMLElement) {
  return within(container)
    .getAllByRole('button')
    .filter((b) => /note/.test(b.textContent ?? ''))
}

it('Recent shows a just-created document after New, without a reload', async () => {
  mount(newClient(), <ReaderPage />)
  expect(await screen.findByText(existing.preview)).toBeInTheDocument()

  paste('A freshly pasted note, read once.')
  await clickRead()
  expect(await screen.findByText(SAVED)).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'New' }))

  const row = await screen.findByRole('button', { name: /freshly pasted/ })
  expect(row).toHaveTextContent(new Date(NEW_DAY).toLocaleDateString())
})

it('an edited document moves to the top of Recent and My Documents with its new preview and time', async () => {
  serverDocs = [other, existing]
  mockGet.mockResolvedValue({
    success: true,
    data: { id: existing.id, content: 'An earlier note.' },
  })
  const edited: Row = {
    ...existing,
    updatedAt: NEW_DAY,
    preview: 'An edited note',
  }
  mockUpdate.mockImplementation(async () => {
    serverDocs = [edited, other]
    return { success: true, data: { id: existing.id } }
  })

  const client = newClient()
  const reader = mount(client, <ReaderPage />)
  const toOpen = await screen.findByText(existing.preview)
  await act(async () => {
    fireEvent.click(toOpen)
  })
  fireEvent.click(screen.getByRole('button', { name: 'Edit text' }))
  paste('An edited note.')
  await clickRead()
  expect(mockUpdate).toHaveBeenCalledWith(existing.id, 'An edited note.')
  expect(await screen.findByText(SAVED)).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Edit text' }))
  await screen.findByText(edited.preview)
  const recent = rowsIn(reader.container)
  expect(recent[0]).toHaveTextContent(edited.preview)
  expect(recent[0]).toHaveTextContent(new Date(NEW_DAY).toLocaleDateString())
  expect(recent[1]).toHaveTextContent(other.preview)
  reader.unmount()

  const history = mount(client, <ReaderHistoryPage />)
  await screen.findByText(edited.preview)
  const rows = rowsIn(history.container)
  expect(rows).toHaveLength(2)
  expect(rows[0]).toHaveTextContent(edited.preview)
  expect(rows[0]).toHaveTextContent(new Date(NEW_DAY).toLocaleString())
  expect(rows[1]).toHaveTextContent(other.preview)
})

describe('leaving /reader while the save is in flight', () => {
  let pending: ReturnType<
    typeof deferred<{ success: true; data: { id: string } }>
  >

  beforeEach(() => {
    pending = deferred()
    mockCreate.mockImplementation(() => pending.promise)
  })

  async function startSavingThenLeave(client: QueryClient) {
    const reader = mount(client, <ReaderPage />)
    expect(await screen.findByText(existing.preview)).toBeInTheDocument()
    paste('A freshly pasted note, read once.')
    await clickRead()
    expect(screen.getByText('Saving…')).toBeInTheDocument()
    reader.unmount()
  }

  async function finishSave() {
    serverDocs = [created, ...serverDocs]
    await act(async () => {
      pending.resolve({ success: true, data: { id: created.id } })
    })
  }

  it('My Documents, already open, picks up the document once the save lands', async () => {
    const client = newClient()
    await startSavingThenLeave(client)

    mount(client, <ReaderHistoryPage />)
    expect(await screen.findByText(existing.preview)).toBeInTheDocument()

    await finishSave()

    expect(await screen.findByText(created.preview)).toBeInTheDocument()
  })

  it('My Documents, opened after the save lands, shows the document', async () => {
    const client = newClient()
    await startSavingThenLeave(client)
    const listCalls = mockList.mock.calls.length

    await finishSave()
    // Nothing is watching the list, so nothing fetches it yet.
    expect(mockList).toHaveBeenCalledTimes(listCalls)

    mount(client, <ReaderHistoryPage />)

    expect(await screen.findByText(created.preview)).toBeInTheDocument()
  })
})

it('a failed save leaves the list as it was', async () => {
  mockCreate.mockImplementation(async () => ({
    success: false,
    error: 'network error',
  }))

  mount(newClient(), <ReaderPage />)
  expect(await screen.findByText(existing.preview)).toBeInTheDocument()
  const listCalls = mockList.mock.calls.length

  paste('A note that will not save.')
  await clickRead()
  expect(await screen.findByText(/couldn.t save/i)).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Edit text' }))
  expect(screen.getByText(existing.preview)).toBeInTheDocument()
  expect(mockList).toHaveBeenCalledTimes(listCalls)
})
