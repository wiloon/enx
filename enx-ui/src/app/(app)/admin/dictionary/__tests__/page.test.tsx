import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import AdminDictionaryPage from '../page'
import { apiService } from '@/services/api'

jest.mock('@/services/api', () => ({
  apiService: {
    adminGetWord: jest.fn(),
    adminGetEcdict: jest.fn(),
    adminSyncWordFromEcdict: jest.fn(),
    adminEditWord: jest.fn(),
  },
}))

const mockGetWord = apiService.adminGetWord as jest.Mock
const mockGetEcdict = apiService.adminGetEcdict as jest.Mock
const mockSync = apiService.adminSyncWordFromEcdict as jest.Mock
const mockEdit = apiService.adminEditWord as jest.Mock

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

  await waitFor(() =>
    expect(screen.getByText(/Out of sync/)).toBeInTheDocument()
  )
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

// ADR-045: where a definition came from, and the admin's edit and approval.
describe('AI-made definitions', () => {
  const aiRow = (over: Record<string, unknown> = {}) => ({
    success: true,
    data: {
      found: true,
      id: 'w1',
      english: 'rizzler',
      chinese: 'n. 很有魅力的人',
      pronunciation: '',
      source: 'ai',
      aiQuality: 9,
      aiPromptVersion: 'v1',
      users: 3,
      lookups: 12,
      ...over,
    },
  })

  beforeEach(() => {
    mockGetEcdict.mockResolvedValue({ success: true, data: { found: false } })
  })

  it('shows where it came from and how much it is used, not the unmaintained loadCount', async () => {
    mockGetWord.mockResolvedValue(aiRow({ loadCount: 0 }))
    renderPage()
    lookUp('rizzler')

    await waitFor(() =>
      expect(screen.getByText('AI (model-written)')).toBeInTheDocument()
    )
    expect(screen.getByText('9 / 10')).toBeInTheDocument()
    expect(screen.getByText('v1')).toBeInTheDocument()
    expect(
      screen.getByText('Users with this word').nextSibling
    ).toHaveTextContent('3')
    expect(screen.getByText('Total lookups').nextSibling).toHaveTextContent(
      '12'
    )
    expect(screen.queryByText('Lookup count')).toBeNull()
    expect(
      screen.getByText('Edited by an admin').nextSibling
    ).toHaveTextContent('Never')
  })

  it('warns that an unreviewed one is hidden from most users', async () => {
    mockGetWord.mockResolvedValue(aiRow())
    renderPage()
    lookUp('rizzler')

    expect(
      await screen.findByText(
        /not yet reviewed — only users who can use AI see it/
      )
    ).toBeInTheDocument()
  })

  it('says a reviewed one is visible to everyone, and offers no approval', async () => {
    mockGetWord.mockResolvedValue(aiRow({ adminEditedAt: 1700000000000 }))
    renderPage()
    lookUp('rizzler')

    expect(
      await screen.findByText(/reviewed by an admin — visible to every user/)
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
  })

  it('approves by saving the definition unchanged', async () => {
    mockGetWord.mockResolvedValue(aiRow({ pronunciation: '/ˈrɪzlər/' }))
    mockEdit.mockResolvedValue({
      success: true,
      data: { success: true, word: {} },
    })
    renderPage()
    lookUp('rizzler')

    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }))

    await waitFor(() =>
      expect(mockEdit).toHaveBeenCalledWith(
        'rizzler',
        'n. 很有魅力的人',
        '/ˈrɪzlər/'
      )
    )
  })

  it('edits the definition', async () => {
    mockGetWord.mockResolvedValue(aiRow())
    mockEdit.mockResolvedValue({
      success: true,
      data: { success: true, word: {} },
    })
    renderPage()
    lookUp('rizzler')

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Chinese definition'), {
      target: { value: 'n. 魅力十足的人' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(mockEdit).toHaveBeenCalledWith('rizzler', 'n. 魅力十足的人', '')
    )
    await waitFor(() =>
      expect(screen.queryByLabelText('Chinese definition')).toBeNull()
    )
  })

  it('keeps the editor open and shows the message when the save is refused', async () => {
    mockGetWord.mockResolvedValue(aiRow())
    mockEdit.mockResolvedValue({
      success: false,
      error: 'chinese or pronunciation is too long',
    })
    renderPage()
    lookUp('rizzler')

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('too long')
    expect(screen.getByLabelText('Chinese definition')).toBeInTheDocument()
  })

  it('cannot edit a word that has no row, or a soft-deleted one', async () => {
    mockGetWord.mockResolvedValue({ success: true, data: { found: false } })
    renderPage()
    lookUp('nothing')
    await waitFor(() =>
      expect(
        screen.getByText(/This word is not in the words table/)
      ).toBeInTheDocument()
    )
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
  })

  it('cannot edit a soft-deleted row', async () => {
    mockGetWord.mockResolvedValue(aiRow({ deletedAt: 1700000000000 }))
    renderPage()
    lookUp('rizzler')

    await screen.findByText('soft-deleted')
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
  })

  it('shows an ECDICT row as ECDICT, with no AI fields', async () => {
    mockGetWord.mockResolvedValue({
      success: true,
      data: {
        found: true,
        english: 'hello',
        chinese: '你好',
        source: 'ecdict',
        users: 0,
        lookups: 0,
      },
    })
    renderPage()
    lookUp('hello')

    await waitFor(() =>
      expect(screen.getByText('Source').nextSibling).toHaveTextContent('ECDICT')
    )
    expect(screen.queryByText('AI confidence')).toBeNull()
    expect(screen.queryByText(/not yet reviewed/)).toBeNull()
    // An ECDICT row can still be corrected by an admin.
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
  })
})
