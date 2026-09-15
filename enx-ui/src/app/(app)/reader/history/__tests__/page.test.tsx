import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ReaderHistoryPage from '../page'
import { apiService } from '@/services/api'

jest.mock('@/services/api', () => ({
  apiService: {
    listReaderDocuments: jest.fn(),
    getReaderDocument: jest.fn(),
    deleteReaderDocument: jest.fn(),
  },
}))

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

const mockList = apiService.listReaderDocuments as jest.Mock
const mockGet = apiService.getReaderDocument as jest.Mock
const mockDelete = apiService.deleteReaderDocument as jest.Mock

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ReaderHistoryPage />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  sessionStorage.clear()
})

it('shows an empty state when there are no saved documents', async () => {
  mockList.mockResolvedValue({ success: true, data: { documents: [] } })

  renderPage()

  expect(await screen.findByText('No saved documents yet.')).toBeInTheDocument()
})

it('lists saved documents newest first, as returned by the API', async () => {
  mockList.mockResolvedValue({
    success: true,
    data: {
      documents: [
        { id: 'doc-2', createdAt: '2026-09-15T00:00:00Z' },
        { id: 'doc-1', createdAt: '2026-09-14T00:00:00Z' },
      ],
    },
  })

  renderPage()

  expect(await screen.findAllByRole('button', { name: /2026/ })).toHaveLength(2)
})

it('shows an error when the list fails to load', async () => {
  mockList.mockResolvedValue({ success: false, error: 'network down' })

  renderPage()

  expect(await screen.findByText('network down')).toBeInTheDocument()
})

it('opens a document: fetches full content, hands it off via sessionStorage, and navigates to /reader', async () => {
  mockList.mockResolvedValue({
    success: true,
    data: { documents: [{ id: 'doc-1', createdAt: '2026-09-14T00:00:00Z' }] },
  })
  mockGet.mockResolvedValue({
    success: true,
    data: {
      id: 'doc-1',
      content: 'full text',
      createdAt: '2026-09-14T00:00:00Z',
      expiresAt: '2026-09-21T00:00:00Z',
    },
  })

  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: /2026/ }))

  await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/reader'))
  expect(mockGet).toHaveBeenCalledWith('doc-1')
  expect(JSON.parse(sessionStorage.getItem('enx-reader-open-doc')!)).toEqual({
    content: 'full text',
  })
})

it('deletes a document and removes it from the list', async () => {
  mockList.mockResolvedValue({
    success: true,
    data: { documents: [{ id: 'doc-1', createdAt: '2026-09-14T00:00:00Z' }] },
  })
  mockDelete.mockResolvedValue({ success: true, data: { success: true } })

  renderPage()
  await screen.findByRole('button', { name: /2026/ })

  fireEvent.click(screen.getByRole('button', { name: 'Delete document' }))

  await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('doc-1'))
  expect(await screen.findByText('No saved documents yet.')).toBeInTheDocument()
})

it('links back to the Reader page', async () => {
  mockList.mockResolvedValue({ success: true, data: { documents: [] } })

  renderPage()
  await screen.findByText('No saved documents yet.')

  expect(screen.getByRole('link', { name: 'Back to Reader' })).toHaveAttribute(
    'href',
    '/reader'
  )
})
