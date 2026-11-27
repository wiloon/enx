import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
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
  render(
    <QueryClientProvider client={client}>
      <CreditHistoryPage />
    </QueryClientProvider>
  )
  return client
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

it('keeps tied transactions distinct through pagination and rerendering', async () => {
  const errors = jest.spyOn(console, 'error').mockImplementation(() => {})
  try {
    mockList
      .mockResolvedValueOnce(
        page([tx({}), tx({ type: 'REFUND', amount: 1 })], 'next')
      )
      .mockResolvedValueOnce(page([tx({}), tx({ type: 'REFUND', amount: 2 })]))
    renderPage()
    await timeline()
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    const group = await screen.findByRole('button', {
      name: /Word translation ×2/,
    })
    fireEvent.click(group)
    const rows = screen.getByRole('list', { name: 'Word translation ×2' })
    expect(within(rows).getAllByRole('listitem')).toHaveLength(2)
    fireEvent.click(group)
    fireEvent.click(group)
    expect(
      within(
        screen.getByRole('list', { name: 'Word translation ×2' })
      ).getAllByRole('listitem')
    ).toHaveLength(2)
    expect(errors.mock.calls.flat().join(' ')).not.toContain('same key')
  } finally {
    errors.mockRestore()
  }
})

describe('expanded groups', () => {
  const sentence = (createdAt: string) =>
    tx({ createdAt, feature: 'translate_sentence' })
  // Two same-day groups, interleaved: words at 0 and 2, sentences at 1 and 3.
  const day = [
    tx({ createdAt: '2026-11-05T22:00:00Z' }),
    sentence('2026-11-05T21:30:00Z'),
    tx({ createdAt: '2026-11-05T21:00:00Z' }),
    sentence('2026-11-05T20:30:00Z'),
  ]
  const groupButton = (name: RegExp) => screen.getByRole('button', { name })

  it('stay open, and no other group opens, after a refetch adds a newer row at the top', async () => {
    mockList.mockResolvedValue(page(day))
    const client = renderPage()
    await screen.findByRole('button', { name: /Sentence translation ×2/ })
    fireEvent.click(groupButton(/Sentence translation ×2/))

    mockList.mockResolvedValue(
      page([
        tx({
          createdAt: '2026-11-05T23:00:00Z',
          type: 'GRANT_TOPUP',
          feature: '',
          amount: 300,
        }),
        ...day,
      ])
    )
    await client.refetchQueries()
    await screen.findByText('Credits purchased')

    expect(groupButton(/Sentence translation ×2/)).toHaveAttribute(
      'aria-expanded',
      'true'
    )
    expect(groupButton(/Word translation ×2/)).toHaveAttribute(
      'aria-expanded',
      'false'
    )
  })

  it('stay open when a refetch adds a newer same-day spend to them', async () => {
    mockList.mockResolvedValue(page(day))
    const client = renderPage()
    await screen.findByRole('button', { name: /Sentence translation ×2/ })
    fireEvent.click(groupButton(/Sentence translation ×2/))

    mockList.mockResolvedValue(page([sentence('2026-11-05T23:00:00Z'), ...day]))
    await client.refetchQueries()

    const group = await screen.findByRole('button', {
      name: /Sentence translation ×3/,
    })
    expect(group).toHaveAttribute('aria-expanded', 'true')
    expect(
      within(
        screen.getByRole('list', { name: 'Sentence translation ×3' })
      ).getAllByRole('listitem')
    ).toHaveLength(3)
    expect(groupButton(/Word translation ×2/)).toHaveAttribute(
      'aria-expanded',
      'false'
    )
  })

  it('are all shown closed after the filter changes', async () => {
    mockList.mockResolvedValue(page(day))
    renderPage()
    await screen.findByRole('button', { name: /Word translation ×2/ })
    fireEvent.click(groupButton(/Word translation ×2/))

    fireEvent.click(
      within(screen.getByRole('group', { name: 'Filter' })).getByRole(
        'button',
        { name: 'Used' }
      )
    )
    await waitFor(() => expect(mockList).toHaveBeenLastCalledWith('', 'out'))
    await screen.findByRole('button', { name: /Word translation ×2/ })

    expect(
      within(screen.getByRole('list', { name: 'Credit transactions' }))
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-expanded'))
    ).toEqual(['false', 'false'])
  })
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
