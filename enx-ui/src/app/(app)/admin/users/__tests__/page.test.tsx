import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import AdminUsersPage from '../page'
import { apiService } from '@/services/api'
import type { AdminUserSummary } from '@/types'

jest.mock('@/services/api', () => ({
  apiService: {
    adminListUsers: jest.fn(),
  },
}))

const mockList = apiService.adminListUsers as jest.Mock

function summary(overrides: Partial<AdminUserSummary> = {}): AdminUserSummary {
  return {
    id: 'u1',
    email: 'reader@example.com',
    name: 'Reader',
    createdAt: '2026-10-01T08:00:00Z',
    lastLoginAt: '2026-10-15T09:30:00Z',
    plan: 'pro',
    subscriptionStatus: 'active',
    balances: {
      subscription: 400,
      topup: 100,
      trial: 0,
      trialExpiresAt: null,
      total: 500,
    },
    totals: { paid: 900, gifted: 0, trial: 100, consumed: 400, clawedBack: 0 },
    hadClawback: false,
    ...overrides,
  }
}

function page(users: AdminUserSummary[], total = users.length) {
  return { success: true, data: { success: true, users, total } }
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <AdminUsersPage />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  jest.clearAllMocks()
})

it('lists users newest first, each linking to its detail page', async () => {
  mockList.mockResolvedValue(page([summary()]))

  renderPage()

  const link = await screen.findByRole('link', { name: 'reader@example.com' })
  expect(link).toHaveAttribute('href', '/admin/users/u1')
  const row = link.closest('tr')!
  expect(within(row).getByText('500')).toBeInTheDocument()
  expect(within(row).getByText('pro · active')).toBeInTheDocument()
  expect(screen.getByText('1 user')).toBeInTheDocument()
  expect(mockList).toHaveBeenCalledWith({
    q: '',
    sort: 'created',
    limit: 50,
    offset: 0,
  })
})

it('shows where the credits came from and when the user last signed in', async () => {
  mockList.mockResolvedValue(
    page([
      summary({
        totals: {
          paid: 900,
          gifted: 25,
          trial: 100,
          consumed: 480,
          clawedBack: 0,
        },
      }),
    ])
  )
  renderPage()

  const row = (
    await screen.findByRole('link', { name: 'reader@example.com' })
  ).closest('tr')!
  expect(within(row).getByText('900')).toBeInTheDocument()
  expect(within(row).getByText('25')).toBeInTheDocument()
  expect(within(row).getByText('480')).toBeInTheDocument()
  expect(within(row).getByText('2026-10-15')).toBeInTheDocument()
})

// ADR-049 Decision 3 and 6: a clawback or an admin deduction can leave the
// top-up pool below zero; the admin should spot those at a glance.
it('flags a negative balance and a past refund clawback', async () => {
  mockList.mockResolvedValue(
    page([
      summary({
        balances: {
          subscription: 0,
          topup: -30,
          trial: 0,
          trialExpiresAt: null,
          total: -30,
        },
        hadClawback: true,
      }),
    ])
  )
  renderPage()

  const row = (
    await screen.findByRole('link', { name: 'reader@example.com' })
  ).closest('tr')!
  expect(within(row).getByText('-30')).toBeInTheDocument()
  expect(within(row).getByText('Negative balance')).toBeInTheDocument()
  expect(within(row).getByText('Refunded')).toBeInTheDocument()
})

it('does not flag a user with a positive balance and no refund', async () => {
  mockList.mockResolvedValue(page([summary()]))
  renderPage()

  await screen.findByText('1 user')
  expect(screen.queryByText('Negative balance')).not.toBeInTheDocument()
  expect(screen.queryByText('Refunded')).not.toBeInTheDocument()
})

it('searches by email from the first page', async () => {
  mockList.mockResolvedValue(page([summary()]))
  renderPage()
  await screen.findByText('1 user')

  fireEvent.change(screen.getByLabelText('Search by email'), {
    target: { value: 'reader@' },
  })
  fireEvent.submit(screen.getByRole('search'))

  await waitFor(() =>
    expect(mockList).toHaveBeenLastCalledWith({
      q: 'reader@',
      sort: 'created',
      limit: 50,
      offset: 0,
    })
  )
})

it.each([
  ['Last sign-in', 'last_login'],
  ['Balance', 'balance'],
])('sorts by %s', async (label, sort) => {
  mockList.mockResolvedValue(page([summary()]))
  renderPage()
  await screen.findByText('1 user')

  fireEvent.change(screen.getByLabelText('Sort by'), {
    target: { value: sort },
  })

  await waitFor(() =>
    expect(mockList).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort, offset: 0 })
    )
  )
  expect(
    (screen.getByRole('option', { name: label }) as HTMLOptionElement).selected
  ).toBe(true)
})

it('pages through the list fifty at a time', async () => {
  mockList.mockResolvedValue(page([summary()], 120))
  renderPage()
  await screen.findByText('120 users')
  expect(screen.getByText('1–50 of 120')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()

  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  await waitFor(() =>
    expect(mockList).toHaveBeenLastCalledWith(
      expect.objectContaining({ offset: 50 })
    )
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Next' }))
  await screen.findByText('101–120 of 120')
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
})

it('says so when no user matches', async () => {
  mockList.mockResolvedValue(page([]))
  renderPage()
  expect(await screen.findByText('No users match.')).toBeInTheDocument()
})

it('shows the API error', async () => {
  mockList.mockResolvedValue({ success: false, error: 'admin access required' })
  renderPage()
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'admin access required'
  )
})
