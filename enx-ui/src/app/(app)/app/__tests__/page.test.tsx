import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import AppHome from '../page'
import { apiService } from '@/services/api'
import { useExtensionStatus } from '@/hooks/useExtensionStatus'

jest.mock('@/services/api', () => ({
  apiService: {
    getStatsOverview: jest.fn(),
    getBillingMe: jest.fn(),
  },
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}))

jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { username: 'yue wang' } }),
}))

jest.mock('@/hooks/useExtensionStatus', () => ({
  useExtensionStatus: jest.fn(),
}))

const mockOverview = apiService.getStatsOverview as jest.Mock
const mockBilling = apiService.getBillingMe as jest.Mock
const mockExtensionStatus = useExtensionStatus as jest.Mock

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

function overview(
  partial: {
    today?: Partial<typeof EMPTY_TOTALS>
    week?: Partial<typeof EMPTY_TOTALS>
    sparkline?: number[]
    vocab?: { total: number; mastered: number }
  } = {}
) {
  return {
    success: true,
    data: {
      today: { ...EMPTY_TOTALS, ...partial.today },
      week: { ...EMPTY_TOTALS, ...partial.week },
      sparkline: partial.sparkline ?? [0, 0, 0, 0, 0, 0, 0],
      vocab: partial.vocab ?? { total: 0, mastered: 0 },
      recent: [],
    },
  }
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <AppHome />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  mockExtensionStatus.mockReturnValue('installed')
  mockBilling.mockResolvedValue({
    success: true,
    data: {
      subscription: { status: 'active', plan: 'pro', currentPeriodEnd: 0 },
      credits: { subscriptionBalance: 1000, topupBalance: 240 },
    },
  })
})

it('walks a user with no data through the three onboarding steps', async () => {
  mockOverview.mockResolvedValue(overview())

  renderPage()

  expect(await screen.findByText('Get started in three steps')).toBeInTheDocument()
  expect(screen.getByText('Catglish is installed')).toBeInTheDocument()
  expect(
    screen.getByRole('link', { name: 'Paste some text instead' })
  ).toBeInTheDocument()
  expect(screen.queryByText('Today')).not.toBeInTheDocument()
})

it('leads a returning user with their own numbers, not a document list', async () => {
  mockOverview.mockResolvedValue(
    overview({
      today: { wordsRead: 1237, wordLookups: 14 },
      week: { wordsRead: 8400 },
      sparkline: [400, 0, 1200, 900, 0, 300, 1237],
      vocab: { total: 312, mastered: 48 },
    })
  )

  renderPage()

  expect(await screen.findByText('Today')).toBeInTheDocument()
  // Rounded, because reading volume is inferred (ADR-028 Decision 8).
  expect(screen.getByText('1,200')).toBeInTheDocument()
  expect(screen.getByText('14')).toBeInTheDocument()
  expect(screen.getByText('312')).toBeInTheDocument()
  expect(screen.queryByText('Get started in three steps')).not.toBeInTheDocument()
  expect(screen.queryByText('Continue reading')).not.toBeInTheDocument()
})

it('links the status strip to the full stats page', async () => {
  mockOverview.mockResolvedValue(overview({ vocab: { total: 5, mastered: 0 } }))

  renderPage()

  const strip = await screen.findByRole('link', { name: /Today/ })
  expect(strip).toHaveAttribute('href', '/stats')
})

it('renders feature entries as links, not buttons (ADR-027 decision 2)', async () => {
  mockOverview.mockResolvedValue(overview())

  renderPage()

  for (const label of ['Word Lookup', 'Rephrase', 'Reader']) {
    const tile = await screen.findByRole('link', { name: label })
    expect(tile.tagName).toBe('A')
  }
  expect(screen.queryByRole('button', { name: /Go to/ })).not.toBeInTheDocument()
})

it('hides the plan card when billing fails instead of taking the page down', async () => {
  mockOverview.mockResolvedValue(overview({ vocab: { total: 5, mastered: 0 } }))
  mockBilling.mockResolvedValue({ success: false, error: 'boom' })

  renderPage()

  expect(await screen.findByText('Today')).toBeInTheDocument()
  await waitFor(() =>
    expect(screen.queryByText(/credits/)).not.toBeInTheDocument()
  )
})

it('keeps a stats failure from blanking the rest of Home', async () => {
  mockOverview.mockResolvedValue({ success: false, error: 'boom' })

  renderPage()

  // No strip, no onboarding (which would be wrong -- we don't know whether
  // this user is new), but the rest of the page still works.
  expect(await screen.findByRole('link', { name: 'Reader' })).toBeInTheDocument()
  await waitFor(() =>
    expect(screen.queryByText('Get started in three steps')).not.toBeInTheDocument()
  )
  expect(screen.queryByText('Today')).not.toBeInTheDocument()
})

it('offers the install banner only when the extension is missing', async () => {
  mockOverview.mockResolvedValue(overview())
  mockExtensionStatus.mockReturnValue('not-installed')

  renderPage()

  expect(
    await screen.findByText(/Add Catglish to Chrome to look up words/)
  ).toBeInTheDocument()
})
