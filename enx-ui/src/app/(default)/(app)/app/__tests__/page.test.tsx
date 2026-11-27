import { act, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import AppHome from '../page'
import { apiService } from '@/services/api'
import { useExtensionStatus } from '@/hooks/useExtensionStatus'
import { setRuntimeEnv } from '@/test/runtimeEnv'

jest.mock('@/services/api', () => ({
  apiService: {
    getStatsOverview: jest.fn(),
    getBillingMe: jest.fn(),
    getPreferences: jest.fn(),
  },
}))

const replace = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace }),
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
  ;(apiService.getPreferences as jest.Mock).mockResolvedValue({
    success: true,
    data: { onboardingCompleted: { effective: true } },
  })
  setRuntimeEnv({})
  mockExtensionStatus.mockReturnValue('installed')
  mockBilling.mockResolvedValue({
    success: true,
    data: {
      subscription: { status: 'active', plan: 'pro', currentPeriodEnd: 0 },
      credits: {
        subscriptionBalance: 1000,
        topupBalance: 240,
        trialBalance: 0,
        trialExpiresAt: null,
      },
    },
  })
})

const STORE_URL = 'https://chromewebstore.google.com/detail/catglish'
const CARD_HEADING = 'Try Catglish in 1 minute'
const FEATURE_LINKS = ['Word Lookup', 'Rephrase', 'Reader']

const expectNoFeatureLinks = () => {
  for (const name of FEATURE_LINKS) {
    expect(screen.queryByRole('link', { name })).not.toBeInTheDocument()
  }
}

// Lets a resolved overview render before asserting on what is absent.
const settle = () =>
  act(() => new Promise((resolve) => setTimeout(resolve, 20)))

// ADR-047 Decision 6, as revised by #624: plain-text steps and one button
// to /welcome, where the steps are done.
it('shows a user with no data a two-step card leading to /welcome', async () => {
  mockOverview.mockResolvedValue(overview())

  renderPage()

  expect(await screen.findByText('0 of 2')).toBeInTheDocument()
  const items = within(screen.getByRole('list')).getAllByRole('listitem')
  expect(items.map((li) => li.textContent)).toEqual([
    '1Turn on Catglish for the article',
    "2Click any word you don't know",
  ])
  expect(
    within(screen.getByRole('list')).queryByRole('link')
  ).not.toBeInTheDocument()
  const toWelcome = screen
    .getAllByRole('link')
    .filter((a) => a.getAttribute('href') === '/welcome')
  expect(toWelcome).toHaveLength(1)
  expect(toWelcome[0]).toHaveAccessibleName(/^Start with a sample article/)
  expect(screen.queryByText('Today')).not.toBeInTheDocument()
})

it('says what the onboarding card gets the user', async () => {
  mockOverview.mockResolvedValue(overview())

  renderPage()

  expect(await screen.findByText(CARD_HEADING)).toBeInTheDocument()
  expect(
    screen.getByText('Read a short sample article and look up your first word.')
  ).toBeInTheDocument()
})

it('numbers the steps in an ordered list', async () => {
  mockOverview.mockResolvedValue(overview())
  mockExtensionStatus.mockReturnValue('not-installed')

  renderPage()

  const list = await screen.findByRole('list')
  expect(list.tagName).toBe('OL')
  within(list)
    .getAllByRole('listitem')
    .forEach((item, i) => expect(item).toHaveTextContent(String(i + 1)))
})

it('puts installing first on the card, with no install banner, when the extension is missing', async () => {
  setRuntimeEnv({ ENX_EXTENSION_WEB_STORE_URL: STORE_URL })
  mockOverview.mockResolvedValue(overview())
  mockExtensionStatus.mockReturnValue('not-installed')

  renderPage()

  expect(await screen.findByText('0 of 3')).toBeInTheDocument()
  const items = within(screen.getByRole('list')).getAllByRole('listitem')
  expect(items[0]).toHaveTextContent('Add Catglish to Chrome')
  expect(
    screen
      .getAllByRole('link')
      .filter((a) => a.getAttribute('href') === '/welcome')
  ).toHaveLength(1)
  expect(
    screen.queryByRole('link', { name: 'Add to Chrome' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Add to Chrome' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByText(/Add Catglish to Chrome to look up words/)
  ).not.toBeInTheDocument()
})

it('holds the card and the banner until the extension check has answered', async () => {
  mockOverview.mockResolvedValue(overview())
  mockExtensionStatus.mockReturnValue('unknown')

  renderPage()

  await waitFor(() => expect(mockOverview).toHaveBeenCalled())
  await settle()
  expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
  expect(screen.queryByText(CARD_HEADING)).not.toBeInTheDocument()
  expect(screen.queryByText(/extension connected/)).not.toBeInTheDocument()
  expect(screen.queryByText('Today')).not.toBeInTheDocument()
})

it('does not say the extension is connected while the onboarding card shows', async () => {
  mockOverview.mockResolvedValue(overview())

  renderPage()

  expect(await screen.findByText(CARD_HEADING)).toBeInTheDocument()
  expect(
    screen.queryByText('Catglish extension connected')
  ).not.toBeInTheDocument()
})

it('keeps the install banner hidden while the overview loads', async () => {
  setRuntimeEnv({ ENX_EXTENSION_WEB_STORE_URL: STORE_URL })
  mockOverview.mockReturnValue(new Promise(() => {}))
  mockExtensionStatus.mockReturnValue('not-installed')

  renderPage()

  await waitFor(() => expect(mockOverview).toHaveBeenCalled())
  await settle()
  expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
  expect(
    screen.queryByRole('link', { name: 'Add to Chrome' })
  ).not.toBeInTheDocument()
  expect(screen.queryByText(CARD_HEADING)).not.toBeInTheDocument()
})

it('shows no feature links to a user with no data', async () => {
  mockOverview.mockResolvedValue(overview())

  renderPage()

  expect(await screen.findByText(CARD_HEADING)).toBeInTheDocument()
  expectNoFeatureLinks()
})

it('shows no feature links to a returning user (the sidebar has them)', async () => {
  mockOverview.mockResolvedValue(overview({ vocab: { total: 5, mastered: 0 } }))

  renderPage()

  expect(await screen.findByText('Today')).toBeInTheDocument()
  expectNoFeatureLinks()
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
  expect(screen.queryByText(CARD_HEADING)).not.toBeInTheDocument()
  expect(screen.queryByText('Continue reading')).not.toBeInTheDocument()
})

it('links the status strip to the full stats page', async () => {
  mockOverview.mockResolvedValue(overview({ vocab: { total: 5, mastered: 0 } }))

  renderPage()

  const strip = await screen.findByRole('link', { name: /Today/ })
  expect(strip).toHaveAttribute('href', '/stats')
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
  setRuntimeEnv({ ENX_EXTENSION_WEB_STORE_URL: STORE_URL })
  mockOverview.mockResolvedValue({ success: false, error: 'boom' })
  mockExtensionStatus.mockReturnValue('not-installed')

  renderPage()

  // No strip, no onboarding (which would be wrong -- we don't know whether
  // this user is new), but the rest of the page still works.
  expect(
    await screen.findByRole('link', { name: 'Add to Chrome' })
  ).toHaveAttribute('href', STORE_URL)
  expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
  expect(screen.queryByText(CARD_HEADING)).not.toBeInTheDocument()
  expect(screen.queryByText('Today')).not.toBeInTheDocument()
})

it('offers a returning user without the extension the install banner', async () => {
  setRuntimeEnv({ ENX_EXTENSION_WEB_STORE_URL: STORE_URL })
  mockOverview.mockResolvedValue(overview({ vocab: { total: 5, mastered: 0 } }))
  mockExtensionStatus.mockReturnValue('not-installed')

  renderPage()

  expect(
    await screen.findByRole('link', { name: 'Add to Chrome' })
  ).toHaveAttribute('href', STORE_URL)
})

// #641: /app is the normal post-authentication destination.
it('takes a new user directly to Welcome before showing the Home checklist', async () => {
  mockOverview.mockResolvedValue(overview())
  ;(apiService.getPreferences as jest.Mock).mockResolvedValue({
    success: true,
    data: { onboardingCompleted: { effective: false } },
  })
  renderPage()
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/welcome'))
  expect(screen.queryByText(CARD_HEADING)).not.toBeInTheDocument()
})

it('waits for account history before choosing the post-authentication destination', async () => {
  mockOverview.mockResolvedValue(overview())
  ;(apiService.getPreferences as jest.Mock).mockReturnValue(
    new Promise(() => {})
  )
  renderPage()
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Opening your setup guide'
  )
  expect(replace).not.toHaveBeenCalled()
  expect(screen.queryByText(CARD_HEADING)).not.toBeInTheDocument()
})

it('keeps a user who skipped setup on Home without a redirect loop', async () => {
  mockOverview.mockResolvedValue(overview())
  renderPage()
  await screen.findByText(CARD_HEADING)
  expect(replace).not.toHaveBeenCalled()
})

it('keeps legacy users with lookups on Home even without a completion flag', async () => {
  mockOverview.mockResolvedValue(overview({ vocab: { total: 5, mastered: 0 } }))
  ;(apiService.getPreferences as jest.Mock).mockResolvedValue({
    success: true,
    data: { onboardingCompleted: { effective: false } },
  })
  renderPage()
  await screen.findByText('Today')
  expect(replace).not.toHaveBeenCalled()
})
