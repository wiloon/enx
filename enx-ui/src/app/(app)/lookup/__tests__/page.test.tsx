import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  QueryClient,
  QueryClientProvider,
  focusManager,
} from '@tanstack/react-query'
import WordLookupPage from '../page'
import { apiService } from '@/services/api'
import type { ApiResponse, WordData } from '@/types'

jest.mock('@/services/api', () => ({
  apiService: {
    lookupWord: jest.fn(),
    recordWordLookup: jest.fn(),
    deleteWord: jest.fn(),
  },
}))

const mockIsAdmin = jest.fn(() => ({ isAdmin: false, isLoading: false }))
jest.mock('@/hooks/useIsAdmin', () => ({ useIsAdmin: () => mockIsAdmin() }))

const mockLookup = apiService.lookupWord as jest.Mock
const mockRecord = apiService.recordWordLookup as jest.Mock
const mockDelete = apiService.deleteWord as jest.Mock

const run: WordData = {
  Id: 'w-run',
  Key: 'run',
  English: 'run',
  Pronunciation: 'rʌn',
  Chinese: 'v. 跑',
  LoadCount: 3,
  Known: true,
  WordType: 0,
}

const found = (word: WordData): ApiResponse<WordData> => ({
  success: true,
  data: word,
})

const recorded: ApiResponse<{ queryCount: number; known: boolean }> = {
  success: true,
  data: { queryCount: 4, known: false },
}

function renderPage(client = new QueryClient()) {
  render(
    <QueryClientProvider client={client}>
      <WordLookupPage />
    </QueryClientProvider>
  )
  return client
}

function submit(word: string) {
  fireEvent.change(screen.getByLabelText('Enter English word'), {
    target: { value: word },
  })
  fireEvent.submit(screen.getByLabelText('Enter English word').closest('form')!)
}

beforeEach(() => {
  jest.clearAllMocks()
  mockIsAdmin.mockReturnValue({ isAdmin: false, isLoading: false })
  mockRecord.mockResolvedValue(recorded)
})

it('looks the word up, records the lookup by the answer’s id and shows the count one on', async () => {
  mockLookup.mockResolvedValue(found(run))
  renderPage()

  submit('Ran')

  expect(await screen.findByTitle('Looked up 4 times')).toBeInTheDocument()
  expect(mockLookup).toHaveBeenCalledTimes(1)
  expect(mockLookup).toHaveBeenCalledWith('ran')
  expect(mockRecord).toHaveBeenCalledTimes(1)
  expect(mockRecord).toHaveBeenCalledWith('w-run')
})

it('looks the word up again and counts again when the same word is resubmitted', async () => {
  mockLookup
    .mockResolvedValueOnce(found(run))
    .mockResolvedValueOnce(found({ ...run, LoadCount: 4 }))
  renderPage()

  submit('run')
  expect(await screen.findByTitle('Looked up 4 times')).toBeInTheDocument()
  submit('run')

  expect(await screen.findByTitle('Looked up 5 times')).toBeInTheDocument()
  expect(mockLookup).toHaveBeenCalledTimes(2)
  expect(mockRecord).toHaveBeenCalledTimes(2)
})

it('sends one lookup for two submits while the first is pending', async () => {
  let answer!: (r: ApiResponse<WordData>) => void
  mockLookup.mockReturnValue(new Promise((resolve) => (answer = resolve)))
  renderPage()

  submit('run')
  await screen.findByRole('button', { name: 'Looking up…' })
  submit('run')
  await act(async () => answer(found(run)))

  expect(await screen.findByTitle('Looked up 4 times')).toBeInTheDocument()
  expect(mockLookup).toHaveBeenCalledTimes(1)
  expect(mockRecord).toHaveBeenCalledTimes(1)
})

it('sends nothing on a re-render or when the window regains focus', async () => {
  mockLookup.mockResolvedValue(found(run))
  const client = new QueryClient()
  const { rerender } = render(
    <QueryClientProvider client={client}>
      <WordLookupPage />
    </QueryClientProvider>
  )
  submit('run')
  expect(await screen.findByTitle('Looked up 4 times')).toBeInTheDocument()

  rerender(
    <QueryClientProvider client={client}>
      <WordLookupPage />
    </QueryClientProvider>
  )
  act(() => {
    focusManager.setFocused(false)
    focusManager.setFocused(true)
  })
  await act(async () => {})
  focusManager.setFocused(undefined)

  expect(mockLookup).toHaveBeenCalledTimes(1)
  expect(mockRecord).toHaveBeenCalledTimes(1)
})

it('says no data was found on a miss and counts nothing', async () => {
  mockLookup.mockResolvedValue(found({ ...run, Chinese: '', Id: '' }))
  renderPage()

  submit('qwzx')

  expect(
    await screen.findByText('No data found for "qwzx"')
  ).toBeInTheDocument()
  expect(screen.queryByText('ID')).not.toBeInTheDocument()
  expect(mockRecord).not.toHaveBeenCalled()
})

it('shows a definition the API could not cache, without counting it', async () => {
  mockLookup.mockResolvedValue(found({ ...run, Chinese: 'n. x', Id: '' }))
  renderPage()

  submit('run')

  expect(await screen.findByText('n. x')).toBeInTheDocument()
  expect(screen.getByTitle('Looked up 3 times')).toBeInTheDocument()
  expect(mockRecord).not.toHaveBeenCalled()
})

it.each([
  [
    'a failed lookup',
    { success: false, error: 'Failed to look up', status: 500 },
  ],
  [
    'a 429',
    {
      success: false,
      error: 'Daily lookup limit reached.',
      status: 429,
    },
  ],
])('shows the API message for %s and counts nothing', async (_, response) => {
  mockLookup.mockResolvedValue(response)
  renderPage()

  submit('run')

  const message = await screen.findByText(response.error)
  expect(message).toHaveClass('text-destructive')
  expect(message.textContent).toBe(response.error)
  expect(mockRecord).not.toHaveBeenCalled()
})

it('still shows the definition when recording the lookup fails', async () => {
  mockLookup.mockResolvedValue(found(run))
  mockRecord.mockResolvedValue({
    success: false,
    error: 'Too many requests',
    status: 429,
  })
  renderPage()

  submit('run')

  expect(await screen.findByText('v. 跑')).toBeInTheDocument()
  expect(screen.queryByText('Too many requests')).not.toBeInTheDocument()
})

function seededClient() {
  const client = new QueryClient()
  client.setQueryData(['word-list', 'all', 'recent', ''], { total: 0 })
  client.setQueryData(['stats-overview'], { vocabulary: 0 })
  return client
}

const invalidated = (client: QueryClient, key: unknown[]) =>
  client.getQueryState(key)?.isInvalidated

it.each([
  ['succeeds', recorded],
  ['fails', { success: false, error: 'Too many requests', status: 429 }],
])(
  'refreshes the Word List and the stats once recording the lookup %s',
  async (_, response) => {
    let settle!: (r: unknown) => void
    mockRecord.mockReturnValue(new Promise((resolve) => (settle = resolve)))
    mockLookup.mockResolvedValue(found(run))
    const client = renderPage(seededClient())

    submit('run')
    expect(await screen.findByText('v. 跑')).toBeInTheDocument()
    expect(invalidated(client, ['word-list', 'all', 'recent', ''])).toBe(false)

    await act(async () => settle(response))

    await waitFor(() =>
      expect(invalidated(client, ['word-list', 'all', 'recent', ''])).toBe(true)
    )
    expect(invalidated(client, ['stats-overview'])).toBe(true)
  }
)

it('refreshes nothing after a miss', async () => {
  mockLookup.mockResolvedValue(found({ ...run, Chinese: '', Id: '' }))
  const client = renderPage(seededClient())

  submit('qwzx')

  expect(
    await screen.findByText('No data found for "qwzx"')
  ).toBeInTheDocument()
  expect(invalidated(client, ['word-list', 'all', 'recent', ''])).toBe(false)
  expect(invalidated(client, ['stats-overview'])).toBe(false)
})

it('holds the card’s place with a skeleton while the lookup is pending', async () => {
  mockLookup.mockReturnValue(new Promise(() => {}))
  renderPage()

  submit('run')

  const button = await screen.findByRole('button', { name: 'Looking up…' })
  expect(button).toBeDisabled()
  expect(screen.getByTestId('word-result-skeleton')).toBeInTheDocument()
  expect(screen.queryByText('Looking up word...')).not.toBeInTheDocument()
})

it('removes the card after an admin clears the word', async () => {
  mockIsAdmin.mockReturnValue({ isAdmin: true, isLoading: false })
  mockLookup.mockResolvedValue(found(run))
  mockDelete.mockResolvedValue({
    success: true,
    data: { success: true, deleted: true },
  })
  renderPage()

  submit('run')
  fireEvent.click(await screen.findByRole('button', { name: 'Clear' }))

  await waitFor(() =>
    expect(screen.queryByText('v. 跑')).not.toBeInTheDocument()
  )
  expect(mockDelete).toHaveBeenCalledWith('run')
  expect(screen.getByLabelText('Enter English word')).toHaveValue('')
})
