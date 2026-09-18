import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ReadingStatsPage from '../page'
import { apiService } from '@/services/api'

jest.mock('@/services/api', () => ({
  apiService: { getStatsSeries: jest.fn() },
}))

const mockSeries = apiService.getStatsSeries as jest.Mock

// jsdom has no ResizeObserver; the chart uses one to size itself and falls
// back to its default width when the callback never fires.
beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

const EMPTY_TOTALS = {
  wordsRead: 0,
  articlesRead: 0,
  wordLookups: 0,
  newWords: 0,
  wordsMastered: 0,
  phraseLookups: 0,
  sentenceTranslations: 0,
  contextLookups: 0,
}

function point(date: string, totals: Partial<typeof EMPTY_TOTALS>) {
  return { date, totals: { ...EMPTY_TOTALS, ...totals } }
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ReadingStatsPage />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  mockSeries.mockResolvedValue({
    success: true,
    data: {
      period: 'day',
      points: [
        point('2026-09-15', { wordsRead: 1200, wordLookups: 18, articlesRead: 2 }),
        point('2026-09-16', { wordsRead: 800, wordLookups: 6, articlesRead: 1 }),
      ],
    },
  })
})

it('asks for daily buckets on first load', async () => {
  renderPage()

  await waitFor(() => expect(mockSeries).toHaveBeenCalled())
  expect(mockSeries.mock.calls[0][0]).toBe('day')
})

it('re-queries the same chart at a new bucket size instead of showing another block', async () => {
  renderPage()

  await waitFor(() => expect(mockSeries).toHaveBeenCalledTimes(1))

  fireEvent.click(screen.getByRole('radio', { name: 'Month' }))

  await waitFor(() => expect(mockSeries).toHaveBeenCalledTimes(2))
  expect(mockSeries.mock.calls[1][0]).toBe('month')

  // One chart, not one per period: the day view is gone, not stacked above.
  expect(screen.getAllByRole('img', { name: /over time/ })).toHaveLength(1)
})

it('switches the plotted measure without refetching', async () => {
  renderPage()

  await waitFor(() => expect(mockSeries).toHaveBeenCalledTimes(1))
  expect(
    await screen.findByText(/Estimated from where you looked words up/)
  ).toBeInTheDocument()

  fireEvent.click(screen.getByRole('radio', { name: 'New-word density' }))

  expect(
    await screen.findByText(/Lookups per 1,000 words/)
  ).toBeInTheDocument()
  // The same series answers every measure, so no second round trip.
  expect(mockSeries).toHaveBeenCalledTimes(1)
})

it('labels the density chart as one where lower is better', async () => {
  renderPage()

  fireEvent.click(await screen.findByRole('radio', { name: 'New-word density' }))

  expect(await screen.findByText(/lower is better/)).toBeInTheDocument()
})

it('leaves a thin bucket unplotted rather than drawing a noise spike', async () => {
  mockSeries.mockResolvedValue({
    success: true,
    data: {
      period: 'day',
      points: [
        point('2026-09-15', { wordsRead: 1000, wordLookups: 10 }),
        // 40 words with 3 lookups is 75 per 1,000 -- a spike that would say
        // this user's vocabulary collapsed (ADR-028 Decision 7).
        point('2026-09-16', { wordsRead: 40, wordLookups: 3 }),
      ],
    },
  })
  renderPage()

  fireEvent.click(await screen.findByRole('radio', { name: 'New-word density' }))

  // The table view is always in the DOM (a <details> summary hides it
  // visually), so the values can be asserted without opening it.
  const table = within(await screen.findByRole('table'))
  expect(table.getByText('10')).toBeInTheDocument()
  expect(table.getByText('—')).toBeInTheDocument()
  expect(
    screen.getByText(/read too little that period for the ratio to mean anything/)
  ).toBeInTheDocument()
})

it('rounds reading volume instead of claiming a precision it lacks', async () => {
  mockSeries.mockResolvedValue({
    success: true,
    data: {
      period: 'day',
      points: [point('2026-09-15', { wordsRead: 1237 })],
    },
  })

  renderPage()

  expect((await screen.findAllByText('1,200')).length).toBeGreaterThan(0)
  // Not in the tile, not on the axis, not in the table: the exact number is
  // never shown, because the measurement never had that precision.
  expect(screen.queryByText('1,237')).not.toBeInTheDocument()
})

it('says the volume is an estimate and that nothing about the page is stored', async () => {
  renderPage()

  expect(await screen.findByText(/Words read is an estimate/)).toBeInTheDocument()
  expect(
    screen.getByText(/never a URL, a page title, or what you were reading/)
  ).toBeInTheDocument()
})

it('keeps a failed load inside the chart card', async () => {
  mockSeries.mockResolvedValue({ success: false, error: 'boom' })

  renderPage()

  expect(
    await screen.findByText("Couldn't load your statistics.")
  ).toBeInTheDocument()
  expect(screen.getByRole('radio', { name: 'Week' })).toBeInTheDocument()
})
