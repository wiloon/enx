import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import WordListPage from '../page'
import { apiService } from '@/services/api'
import type { WordListEntry } from '@/types'

jest.mock('@/services/api', () => ({
  apiService: { listMyWords: jest.fn() },
}))

const mockList = apiService.listMyWords as jest.Mock

function entry(over: Partial<WordListEntry>): WordListEntry {
  return {
    english: 'ephemeral',
    chinese: 'adj. 短暂的',
    pronunciation: "i'femərəl",
    queryCount: 1,
    known: false,
    firstLookedUpAt: '2026-10-01T09:00:00Z',
    updatedAt: '2026-10-01T09:00:00Z',
    ...over,
  }
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <WordListPage />
    </QueryClientProvider>
  )
}

beforeEach(() => jest.clearAllMocks())

it('lists each word with its definition, lookup count and known badge', async () => {
  mockList.mockResolvedValue({
    success: true,
    data: {
      total: 2,
      words: [
        entry({ english: 'ephemeral', queryCount: 3 }),
        entry({
          english: 'meticulous',
          chinese: 'adj. 一丝不苟的',
          queryCount: 1,
          known: true,
        }),
      ],
    },
  })

  renderPage()

  expect(await screen.findByText('ephemeral')).toBeInTheDocument()
  expect(screen.getByText('Looked up 3 times')).toBeInTheDocument()
  expect(screen.getByText('Looked up 1 time')).toBeInTheDocument()
  expect(screen.getByText('adj. 一丝不苟的')).toBeInTheDocument()
  const items = within(screen.getByRole('list')).getAllByRole('listitem')
  expect(within(items[0]).queryByText('Known')).not.toBeInTheDocument()
  expect(within(items[1]).getByText('Known')).toBeInTheDocument()
  expect(screen.getByText('2 words')).toBeInTheDocument()
  expect(mockList).toHaveBeenCalledWith({
    status: 'all',
    q: undefined,
    limit: 50,
    offset: 0,
  })
})

it('refetches with the chosen filter', async () => {
  mockList.mockResolvedValue({ success: true, data: { total: 0, words: [] } })
  renderPage()
  await screen.findByText('0 words')

  fireEvent.click(screen.getByRole('button', { name: 'Known' }))

  await waitFor(() =>
    expect(mockList).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'known', offset: 0 })
    )
  )
  expect(screen.getByRole('button', { name: 'Known' })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  expect(
    await screen.findByText('No words marked as known yet.')
  ).toBeInTheDocument()
})

it('searches once the user stops typing', async () => {
  mockList.mockResolvedValue({ success: true, data: { total: 0, words: [] } })
  renderPage()
  await screen.findByText('0 words')

  fireEvent.change(screen.getByRole('searchbox', { name: 'Search words' }), {
    target: { value: ' eph ' },
  })

  await waitFor(() =>
    expect(mockList).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: 'eph' })
    )
  )
  expect(
    await screen.findByText('No words start with "eph".')
  ).toBeInTheDocument()
})

it('loads the next page from where the loaded words end', async () => {
  const first = Array.from({ length: 50 }, (_, i) =>
    entry({ english: `w${i}` })
  )
  mockList
    .mockResolvedValueOnce({ success: true, data: { total: 51, words: first } })
    .mockResolvedValueOnce({
      success: true,
      data: { total: 51, words: [entry({ english: 'last' })] },
    })

  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: 'Load more' }))

  expect(await screen.findByText('last')).toBeInTheDocument()
  expect(mockList).toHaveBeenLastCalledWith(
    expect.objectContaining({ offset: 50 })
  )
  expect(
    screen.queryByRole('button', { name: 'Load more' })
  ).not.toBeInTheDocument()
})

it('points a new user at the extension when the list is empty', async () => {
  mockList.mockResolvedValue({ success: true, data: { total: 0, words: [] } })
  renderPage()
  expect(
    await screen.findByText(/Turn on Catglish on an English page/)
  ).toBeInTheDocument()
})

it('shows the error when the list cannot be loaded', async () => {
  mockList.mockResolvedValue({
    success: false,
    error: 'could not load your word list',
  })
  renderPage()
  expect(
    await screen.findByText('could not load your word list')
  ).toBeInTheDocument()
})
