import { fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import CreditHistoryPage from '../page'
import { apiService } from '@/services/api'
import type { CreditTransaction } from '@/types'

jest.mock('@/services/api', () => ({
  apiService: { listCreditTransactions: jest.fn() },
}))

const mockList = apiService.listCreditTransactions as jest.Mock

function tx(overrides: Partial<CreditTransaction>): CreditTransaction {
  return {
    createdAt: '2026-11-05T20:00:00Z',
    type: 'SETTLE',
    feature: 'translate_word_in_context',
    amount: -2,
    totalBalanceAfter: 100,
    ...overrides,
  }
}

function page(transactions: CreditTransaction[], next = '') {
  return { success: true, data: { success: true, transactions, next } }
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <CreditHistoryPage />
    </QueryClientProvider>
  )
}

const timeline = () =>
  screen.findByRole('list', { name: 'Credit transactions' })

beforeEach(() => {
  jest.clearAllMocks()
  mockList.mockResolvedValue(page([]))
})

// The jest process runs in America/Los_Angeles (jest.config.js).
it('shows each row in browser-local time, labelled, signed and with the total balance after', async () => {
  mockList.mockResolvedValue(
    page([
      tx({
        createdAt: '2026-11-06T01:30:00Z',
        type: 'GRANT_TOPUP',
        feature: '',
        amount: 300,
        totalBalanceAfter: 480,
      }),
      tx({
        createdAt: '2026-10-01T09:00:00Z',
        type: 'GRANT_TRIAL',
        feature: '',
        amount: 100,
        totalBalanceAfter: null,
      }),
    ])
  )
  renderPage()

  const [topup, trial] = within(await timeline()).getAllByRole('listitem')
  expect(topup).toHaveTextContent('Credits purchased')
  expect(topup).toHaveTextContent('Nov 5, 2026 · 17:30')
  expect(topup).toHaveTextContent('+300')
  expect(topup).toHaveTextContent('480')
  expect(trial).toHaveTextContent('Free trial credits')
  expect(trial).toHaveTextContent('—')
  expect(mockList).toHaveBeenCalledWith('', '')
})

it('groups same-day AI spend into one row that expands into its rows', async () => {
  mockList.mockResolvedValue(
    page([
      tx({ createdAt: '2026-11-06T10:00:00Z' }),
      tx({ createdAt: '2026-11-06T01:30:00Z', totalBalanceAfter: 90 }),
      tx({
        createdAt: '2026-11-06T01:00:00Z',
        type: 'REFUND',
        amount: 2,
        totalBalanceAfter: 92,
      }),
      tx({ createdAt: '2026-11-05T20:00:00Z', amount: -3 }),
    ])
  )
  renderPage()

  const list = await timeline()
  const group = within(list).getByRole('button', {
    name: /Word translation ×2/,
  })
  expect(group).toHaveAttribute('aria-expanded', 'false')
  expect(group).toHaveTextContent('Nov 5, 2026')
  expect(group).toHaveTextContent('-5')
  expect(group).toHaveTextContent('90')
  expect(
    within(list).getByText('AI request failed, credits returned')
  ).toBeInTheDocument()
  // 02:00 on Nov 6 local: same UTC day as the 17:30 row, but not grouped.
  expect(within(list).getByText('Nov 6, 2026 · 02:00')).toBeInTheDocument()
  expect(within(list).queryByText('12:00')).not.toBeInTheDocument()

  fireEvent.click(group)

  expect(group).toHaveAttribute('aria-expanded', 'true')
  const rows = within(list).getByRole('list', { name: 'Word translation ×2' })
  const [newest, oldest] = within(rows).getAllByRole('listitem')
  expect(newest).toHaveTextContent('17:30')
  expect(newest).toHaveTextContent('-2')
  expect(oldest).toHaveTextContent('12:00')
  expect(oldest).toHaveTextContent('-3')
})

it('merges a group across pages once the next page loads', async () => {
  mockList
    .mockResolvedValueOnce(
      page([tx({ createdAt: '2026-11-05T22:00:00Z' })], 'cursor-1')
    )
    .mockResolvedValueOnce(page([tx({ createdAt: '2026-11-05T21:00:00Z' })]))
  renderPage()

  const list = await timeline()
  expect(within(list).getByText('Word translation')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Load more' }))

  expect(
    await within(list).findByRole('button', { name: /Word translation ×2/ })
  ).toBeInTheDocument()
  expect(mockList).toHaveBeenLastCalledWith('cursor-1', '')
})

it('shows +0 and why on rows that changed nothing', async () => {
  mockList.mockResolvedValue(
    page([
      tx({ type: 'GRANT_SUBSCRIPTION', feature: '', amount: 0 }),
      tx({ type: 'CLAWBACK', feature: '', amount: 0 }),
    ])
  )
  renderPage()

  const [grant, clawback] = within(await timeline()).getAllByRole('listitem')
  expect(grant).toHaveTextContent('Subscription payment recorded')
  expect(grant).toHaveTextContent('No credits added')
  expect(grant).toHaveTextContent('+0')
  expect(clawback).toHaveTextContent('Refund recorded')
  expect(clawback).toHaveTextContent('No credits removed')
  expect(clawback).toHaveTextContent('+0')
})

it("shows support's reason on an admin grant, and no admin-only fields", async () => {
  mockList.mockResolvedValue(
    page([
      tx({
        type: 'GRANT_ADMIN',
        feature: '',
        amount: 25,
        note: 'outage comp',
      }),
      tx({ createdAt: '2026-11-04T20:00:00Z' }),
    ])
  )
  renderPage()

  const list = await timeline()
  expect(
    within(list).getByText('Note from support: outage comp')
  ).toBeInTheDocument()
  expect(within(list).queryByText(/GRANT_ADMIN/)).not.toBeInTheDocument()
  expect(
    within(list).queryByText(/translate_word_in_context/)
  ).not.toBeInTheDocument()
  expect(within(list).queryByText(/pool after/)).not.toBeInTheDocument()
  expect(within(list).queryByText(/source/i)).not.toBeInTheDocument()
})

it('asks the server for added or used rows when the filter changes', async () => {
  mockList.mockImplementation(async (_before: string, direction: string) =>
    direction === 'out'
      ? page([tx({})])
      : page([
          tx({
            type: 'GRANT_TOPUP',
            feature: '',
            amount: 300,
          }),
        ])
  )
  renderPage()
  const filters = screen.getByRole('group', { name: 'Filter' })
  expect(within(filters).getByRole('button', { name: 'All' })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  expect(await screen.findByText('Credits purchased')).toBeInTheDocument()

  fireEvent.click(within(filters).getByRole('button', { name: 'Used' }))

  expect(await screen.findByText('Word translation')).toBeInTheDocument()
  expect(screen.queryByText('Credits purchased')).not.toBeInTheDocument()
  expect(mockList).toHaveBeenLastCalledWith('', 'out')
  expect(within(filters).getByRole('button', { name: 'Used' })).toHaveAttribute(
    'aria-pressed',
    'true'
  )

  fireEvent.click(within(filters).getByRole('button', { name: 'Added' }))
  await screen.findByText('Credits purchased')
  expect(mockList).toHaveBeenLastCalledWith('', 'in')
})

it('says when there is nothing to show yet', async () => {
  renderPage()
  expect(
    await screen.findByText('No credit transactions yet.')
  ).toBeInTheDocument()
})

it('shows why the history failed to load', async () => {
  mockList.mockResolvedValue({
    success: false,
    error: 'failed to load your credit history',
  })
  renderPage()
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'failed to load your credit history'
  )
})

it('links back to billing', () => {
  renderPage()
  expect(screen.getByRole('link', { name: /Billing/ })).toHaveAttribute(
    'href',
    '/billing'
  )
})
