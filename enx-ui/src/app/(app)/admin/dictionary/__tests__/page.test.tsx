import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import AdminDictionaryPage from '../page'
import { apiService } from '@/services/api'

jest.mock('@/services/api', () => ({
  apiService: {
    adminGetWord: jest.fn(),
    adminGetEcdict: jest.fn(),
    adminSyncWordFromEcdict: jest.fn(),
  },
}))

const mockGetWord = apiService.adminGetWord as jest.Mock
const mockGetEcdict = apiService.adminGetEcdict as jest.Mock
const mockSync = apiService.adminSyncWordFromEcdict as jest.Mock

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <AdminDictionaryPage />
    </QueryClientProvider>
  )
}

function lookUp(word: string) {
  fireEvent.change(screen.getByLabelText('English word'), {
    target: { value: word },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Look Up' }))
}

beforeEach(() => {
  jest.clearAllMocks()
})

it('reports "in sync" when the words row matches ECDICT', async () => {
  mockGetWord.mockResolvedValue({
    success: true,
    data: {
      found: true,
      english: 'hello',
      chinese: '你好',
      pronunciation: '/h/',
    },
  })
  mockGetEcdict.mockResolvedValue({
    success: true,
    data: {
      found: true,
      matchedBy: 'exact',
      word: 'hello',
      translation: '你好',
      phonetic: '/h/',
    },
  })
  renderPage()
  lookUp('hello')

  await waitFor(() => expect(screen.getByText(/In sync/)).toBeInTheDocument())
})

it('reports which fields are out of sync', async () => {
  mockGetWord.mockResolvedValue({
    success: true,
    data: { found: true, chinese: '旧', pronunciation: '/old/' },
  })
  mockGetEcdict.mockResolvedValue({
    success: true,
    data: { found: true, translation: '新', phonetic: '/old/' },
  })
  renderPage()
  lookUp('run')

  await waitFor(() => expect(screen.getByText(/Out of sync/)).toBeInTheDocument())
  expect(screen.getByText(/translation differs/)).toBeInTheDocument()
})

it('flags a word missing from the words table', async () => {
  mockGetWord.mockResolvedValue({ success: true, data: { found: false } })
  mockGetEcdict.mockResolvedValue({
    success: true,
    data: { found: true, translation: '你好', phonetic: '/h/' },
  })
  renderPage()
  lookUp('hello')

  await waitFor(() =>
    expect(screen.getByText(/Missing from the words table/)).toBeInTheDocument()
  )
})

it('flags a word absent from both sources', async () => {
  mockGetWord.mockResolvedValue({ success: true, data: { found: false } })
  mockGetEcdict.mockResolvedValue({ success: true, data: { found: false } })
  renderPage()
  lookUp('zzz')

  await waitFor(() =>
    expect(
      screen.getByText(/Not found in the words table or in ECDICT/)
    ).toBeInTheDocument()
  )
})

it('disables Sync when there is no ECDICT entry', async () => {
  mockGetWord.mockResolvedValue({
    success: true,
    data: { found: true, chinese: '手工' },
  })
  mockGetEcdict.mockResolvedValue({ success: true, data: { found: false } })
  renderPage()
  lookUp('handmade')

  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Sync from ECDICT' })
    ).toBeDisabled()
  )
})

it('syncs from ECDICT and refreshes both panels', async () => {
  mockGetWord
    .mockResolvedValueOnce({ success: true, data: { found: false } })
    .mockResolvedValue({
      success: true,
      data: { found: true, chinese: '你好；喂', pronunciation: '/h/' },
    })
  mockGetEcdict.mockResolvedValue({
    success: true,
    data: { found: true, translation: '你好；喂', phonetic: '/h/' },
  })
  mockSync.mockResolvedValue({
    success: true,
    data: {
      success: true,
      matchedBy: 'exact',
      word: { found: true, chinese: '你好；喂' },
    },
  })
  renderPage()
  lookUp('hello')

  await waitFor(() =>
    expect(screen.getByText(/Missing from the words table/)).toBeInTheDocument()
  )

  fireEvent.click(screen.getByRole('button', { name: 'Sync from ECDICT' }))

  await waitFor(() =>
    expect(screen.getByText('Synced from ECDICT.')).toBeInTheDocument()
  )
  expect(mockSync).toHaveBeenCalledWith('hello')
  await waitFor(() => expect(screen.getByText(/In sync/)).toBeInTheDocument())
})
