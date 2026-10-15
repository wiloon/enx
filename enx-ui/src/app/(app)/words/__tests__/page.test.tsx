import {
  act,
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
  apiService: { listMyWords: jest.fn(), removeMyWord: jest.fn() },
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

describe('removing a word', () => {
  const mockRemove = apiService.removeMyWord as jest.Mock

  beforeEach(() => {
    jest.useFakeTimers()
    mockList.mockResolvedValue({
      success: true,
      data: {
        total: 2,
        words: [
          entry({ english: 'ephemeral' }),
          entry({ english: 'meticulous' }),
        ],
      },
    })
    mockRemove.mockResolvedValue({ success: true, data: { success: true } })
  })

  afterEach(() => jest.useRealTimers())

  const listed = () =>
    within(screen.getByRole('list'))
      .getAllByRole('listitem')
      .map((li) => li.querySelector('.font-medium')?.textContent)

  async function clickRemove(english: string) {
    fireEvent.click(
      await screen.findByRole('button', {
        name: `Remove ${english} from your word list`,
      })
    )
  }

  it('hides the word at once and offers to undo', async () => {
    renderPage()
    await clickRemove('ephemeral')

    expect(listed()).toEqual(['meticulous'])
    expect(screen.getByRole('status')).toHaveTextContent('Removed ephemeral')
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()
    expect(screen.getByText('1 word')).toBeInTheDocument()
    expect(mockRemove).not.toHaveBeenCalled()
  })

  it('puts the word back on Undo and never removes it', async () => {
    renderPage()
    await clickRemove('ephemeral')

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await act(() => jest.advanceTimersByTimeAsync(10_000))

    expect(listed()).toEqual(['ephemeral', 'meticulous'])
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(mockRemove).not.toHaveBeenCalled()
  })

  it('removes the word for good once the undo offer runs out', async () => {
    renderPage()
    await clickRemove('ephemeral')

    await act(() => jest.advanceTimersByTimeAsync(4_999))
    expect(mockRemove).not.toHaveBeenCalled()
    await act(() => jest.advanceTimersByTimeAsync(1))

    expect(mockRemove).toHaveBeenCalledTimes(1)
    expect(mockRemove).toHaveBeenCalledWith('ephemeral')
    await waitFor(() =>
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    )
    expect(listed()).toEqual(['meticulous'])
    expect(screen.getByText('1 word')).toBeInTheDocument()
  })

  it('puts the word back and says so when the server will not remove it', async () => {
    mockRemove.mockResolvedValue({
      success: false,
      error: 'could not remove the word',
    })
    renderPage()
    await clickRemove('ephemeral')

    await act(() => jest.advanceTimersByTimeAsync(5_000))

    expect(
      await screen.findByText('could not remove the word')
    ).toBeInTheDocument()
    expect(listed()).toEqual(['ephemeral', 'meticulous'])
    expect(screen.getByText('2 words')).toBeInTheDocument()
  })

  it('removes the first word straight away when a second one is removed', async () => {
    renderPage()
    await clickRemove('ephemeral')
    await clickRemove('meticulous')

    expect(mockRemove).toHaveBeenCalledWith('ephemeral')
    expect(screen.getByRole('status')).toHaveTextContent('Removed meticulous')
    await waitFor(() =>
      expect(screen.queryByRole('list')).not.toBeInTheDocument()
    )
    expect(screen.getByText('0 words')).toBeInTheDocument()
  })

  it('still removes the word when the user leaves the page before it is sent', async () => {
    const { unmount } = renderPage()
    await clickRemove('ephemeral')

    unmount()

    expect(mockRemove).toHaveBeenCalledWith('ephemeral')
  })
})
