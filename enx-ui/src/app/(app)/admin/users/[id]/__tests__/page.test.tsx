import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import AdminUserPage from '../page'
import { apiService } from '@/services/api'
import type { AdminLedgerEntry, AdminUserDetail } from '@/types'

jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'u1' }),
}))

jest.mock('@/services/api', () => ({
  apiService: {
    adminGetUser: jest.fn(),
    adminListUserTransactions: jest.fn(),
    adminAdjustCredits: jest.fn(),
  },
}))

const mockGetUser = apiService.adminGetUser as jest.Mock
const mockLedger = apiService.adminListUserTransactions as jest.Mock

function days(counts: Record<string, number>) {
  const out = []
  for (let d = 17; d <= 46; d++) {
    const date = new Date(Date.UTC(2026, 8, d)).toISOString().slice(0, 10)
    out.push({ date, count: counts[date] ?? 0 })
  }
  return out
}

function detail(
  overrides: Partial<AdminUserDetail['user']> = {}
): AdminUserDetail {
  return {
    user: {
      id: 'u1',
      email: 'reader@example.com',
      name: 'Reader',
      createdAt: '2026-10-01T08:00:00Z',
      lastLoginAt: '2026-10-15T09:30:00Z',
      plan: 'pro',
      subscriptionStatus: 'active',
      balances: {
        subscription: 400,
        topup: 120,
        trial: 60,
        trialExpiresAt: '2026-10-20T00:00:00Z',
        total: 580,
      },
      totals: {
        paid: 900,
        gifted: 25,
        trial: 100,
        consumed: 385,
        clawedBack: 90,
      },
      hadClawback: true,
      stripeCustomerId: 'cus_123',
      stripeDashboardUrl: 'https://dashboard.stripe.com/test/customers/cus_123',
      ...overrides,
    },
    dailyLookups: days({ '2026-10-16': 4, '2026-10-14': 3 }),
    aiSpend: [
      { feature: 'translate_sentence', credits: 120 },
      { feature: 'idiom_notes', credits: 30 },
    ],
  }
}

function entry(overrides: Partial<AdminLedgerEntry>): AdminLedgerEntry {
  return {
    id: 't1',
    type: 'GRANT_TOPUP',
    amount: 300,
    balanceAfter: 300,
    feature: '',
    note: '',
    createdAt: '2026-10-02T10:00:00Z',
    source: 'stripe',
    ...overrides,
  }
}

function ok<T>(data: T) {
  return { success: true, data: { success: true, ...data } }
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <AdminUserPage />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetUser.mockResolvedValue(ok(detail()))
  mockLedger.mockResolvedValue(ok({ transactions: [], next: '' }))
})

it('shows the account, its balances by pool and where credits came from', async () => {
  renderPage()

  expect(
    await screen.findByRole('heading', { name: 'reader@example.com' })
  ).toBeInTheDocument()
  const balances = screen.getByRole('region', { name: 'Balances' })
  expect(within(balances).getByText('580')).toBeInTheDocument()
  expect(within(balances).getByText('400')).toBeInTheDocument()
  expect(within(balances).getByText('120')).toBeInTheDocument()
  expect(within(balances).getByText('60')).toBeInTheDocument()
  expect(within(balances).getByText('expires 2026-10-20')).toBeInTheDocument()

  const totals = screen.getByRole('region', { name: 'Lifetime' })
  expect(within(totals).getByText('900')).toBeInTheDocument()
  expect(within(totals).getByText('385')).toBeInTheDocument()
  expect(within(totals).getByText('90')).toBeInTheDocument()
  expect(mockGetUser).toHaveBeenCalledWith('u1')
})

// ADR-049 Decision 12: counts only, never the words or pages themselves.
it('shows lookups per UTC day and AI spend by feature over the last 30 days', async () => {
  renderPage()

  const usage = await screen.findByRole('region', { name: 'Last 30 days' })
  expect(within(usage).getByText('7 lookups')).toBeInTheDocument()
  expect(within(usage).getByTitle('2026-10-16: 4 lookups')).toBeInTheDocument()
  expect(within(usage).getByTitle('2026-09-17: 0 lookups')).toBeInTheDocument()
  const spend = within(usage).getByRole('table', { name: 'AI spend' })
  const first = within(spend).getAllByRole('row')[1]
  expect(first).toHaveTextContent('translate_sentence')
  expect(first).toHaveTextContent('120')
})

it('says when there was no AI spend', async () => {
  mockGetUser.mockResolvedValue(ok({ ...detail(), aiSpend: [] }))
  renderPage()

  const usage = await screen.findByRole('region', { name: 'Last 30 days' })
  expect(within(usage).getByText('No AI spend.')).toBeInTheDocument()
})

it('links to the customer in the Stripe Dashboard, in a new tab', async () => {
  renderPage()

  const link = await screen.findByRole('link', { name: /Stripe Dashboard/ })
  expect(link).toHaveAttribute(
    'href',
    'https://dashboard.stripe.com/test/customers/cus_123'
  )
  expect(link).toHaveAttribute('target', '_blank')
})

it('says there is no Stripe customer for a user who never paid', async () => {
  mockGetUser.mockResolvedValue(
    ok(detail({ stripeCustomerId: '', stripeDashboardUrl: '' }))
  )
  renderPage()

  expect(await screen.findByText('No Stripe customer')).toBeInTheDocument()
  expect(
    screen.queryByRole('link', { name: /Stripe Dashboard/ })
  ).not.toBeInTheDocument()
})

it('says so for an unknown user', async () => {
  mockGetUser.mockResolvedValue({ success: false, error: 'no such user' })
  renderPage()

  expect(await screen.findByRole('alert')).toHaveTextContent('no such user')
})

it('shows the ledger newest first and loads older entries on request', async () => {
  mockLedger
    .mockResolvedValueOnce(
      ok({
        transactions: [
          entry({
            id: 't3',
            type: 'CLAWBACK',
            amount: -90,
            balanceAfter: 210,
            createdAt: '2026-10-05T10:00:00Z',
            source: 'refund',
          }),
          entry({
            id: 't2',
            type: 'GRANT_ADMIN',
            amount: 25,
            balanceAfter: 300,
            note: 'support comp',
            createdAt: '2026-10-04T10:00:00Z',
            source: 'admin',
          }),
        ],
        next: '1759572000000_2',
      })
    )
    .mockResolvedValueOnce(
      ok({
        transactions: [
          entry({
            id: 't1',
            type: 'SETTLE',
            amount: -40,
            balanceAfter: 275,
            feature: 'translate_sentence',
            createdAt: '2026-10-03T10:00:00Z',
            source: 'ai',
          }),
        ],
        next: '',
      })
    )
  renderPage()

  const ledger = await screen.findByRole('region', { name: 'Ledger' })
  const rows = await within(ledger).findAllByRole('listitem')
  expect(rows).toHaveLength(2)
  expect(rows[0]).toHaveTextContent('Refund clawback')
  expect(rows[0]).toHaveTextContent('-90')
  expect(rows[0]).toHaveTextContent('2026-10-05 10:00 UTC')
  expect(rows[1]).toHaveTextContent('Admin grant')
  expect(rows[1]).toHaveTextContent('+25')
  expect(rows[1]).toHaveTextContent('support comp')
  expect(mockLedger).toHaveBeenCalledWith('u1', '')

  fireEvent.click(within(ledger).getByRole('button', { name: 'Load more' }))

  expect(await within(ledger).findByText('AI usage')).toBeInTheDocument()
  expect(within(ledger).getAllByRole('listitem')).toHaveLength(3)
  expect(within(ledger).getByText('translate_sentence')).toBeInTheDocument()
  expect(mockLedger).toHaveBeenLastCalledWith('u1', '1759572000000_2')
  expect(
    within(ledger).queryByRole('button', { name: 'Load more' })
  ).not.toBeInTheDocument()
})

it('reloads the balances and the ledger after an admin grant', async () => {
  ;(apiService.adminAdjustCredits as jest.Mock).mockResolvedValue(
    ok({ balance: 605 })
  )
  renderPage()
  const adjust = await screen.findByRole('region', { name: 'Adjust credits' })
  await waitFor(() => expect(mockLedger).toHaveBeenCalledTimes(1))

  fireEvent.change(within(adjust).getByLabelText('Credits'), {
    target: { value: '25' },
  })
  fireEvent.change(within(adjust).getByLabelText('Reason'), {
    target: { value: 'support comp' },
  })
  fireEvent.click(within(adjust).getByRole('button', { name: 'Grant credits' }))

  await waitFor(() => expect(mockGetUser).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(mockLedger).toHaveBeenCalledTimes(2))
  expect(apiService.adminAdjustCredits).toHaveBeenCalledWith('grant', {
    email: 'reader@example.com',
    amount: 25,
    reason: 'support comp',
  })
})

it('says when the ledger is empty', async () => {
  renderPage()
  const ledger = await screen.findByRole('region', { name: 'Ledger' })
  expect(
    await within(ledger).findByText('No credit transactions yet.')
  ).toBeInTheDocument()
})
