import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import AdminUsersPage from '../page'
import AdminUserPage from '../[id]/page'
import { apiService } from '@/services/api'
import type { AdminUserDetail, AdminUserSummary } from '@/types'

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'u1' }),
  useRouter: () => ({ push: mockPush }),
}))

jest.mock('@/services/api', () => ({
  apiService: {
    adminListUsers: jest.fn(),
    adminGetUser: jest.fn(),
    adminListUserTransactions: jest.fn(),
    adminAdjustCredits: jest.fn(),
    adminUserAction: jest.fn(),
    adminDeleteUser: jest.fn(),
  },
}))

const mockList = apiService.adminListUsers as jest.Mock
const mockGetUser = apiService.adminGetUser as jest.Mock
const mockLedger = apiService.adminListUserTransactions as jest.Mock
const mockAdjust = apiService.adminAdjustCredits as jest.Mock
const mockDelete = apiService.adminDeleteUser as jest.Mock

function summary(
  id: string,
  overrides: Partial<AdminUserSummary> = {}
): AdminUserSummary {
  return {
    id,
    email: `${id}@example.com`,
    name: id,
    status: 'active',
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

const rowsBefore = [summary('u1'), summary('u2')]
const rowsAfterDelete = [summary('u2')]
const rowsAfterAdjust = [
  summary('u1', {
    balances: {
      subscription: 400,
      topup: 150,
      trial: 0,
      trialExpiresAt: null,
      total: 550,
    },
    totals: { paid: 900, gifted: 50, trial: 100, consumed: 400, clawedBack: 0 },
  }),
  summary('u2'),
]

function page(users: AdminUserSummary[]) {
  return {
    success: true,
    data: { success: true, users, total: users.length },
  }
}

function detail(): AdminUserDetail {
  return {
    user: {
      ...summary('u1'),
      stripeCustomerId: '',
      stripeDashboardUrl: '',
    },
    dailyLookups: [],
    aiSpend: [],
  } as unknown as AdminUserDetail
}

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

// The production staleTime (QueryProvider): a remount does not refetch a
// fresh query, so only invalidation can show the mutation's effect.
function newClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 5 * 60 * 1000 },
      mutations: { retry: false },
    },
  })
}

function renderIn(client: QueryClient, ui: React.ReactElement) {
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

async function warmList(client: QueryClient) {
  const list = renderIn(client, <AdminUsersPage />)
  await screen.findByText('2 users')
  list.unmount()
}

async function deleteThroughDetail(client: QueryClient) {
  const detailView = renderIn(client, <AdminUserPage />)
  mockPush.mockImplementation(() => detailView.unmount())
  await screen.findByRole('heading', { name: 'u1@example.com' })
  fireEvent.click(screen.getByRole('button', { name: 'Delete account' }))
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/admin/users'))
}

async function adjustThroughDetail(client: QueryClient) {
  const detailView = renderIn(client, <AdminUserPage />)
  await screen.findByRole('heading', { name: 'u1@example.com' })
  fireEvent.change(screen.getByLabelText('Credits'), {
    target: { value: '50' },
  })
  fireEvent.change(screen.getByLabelText('Reason'), {
    target: { value: 'Outage credit' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Grant credits' }))
  await screen.findByRole('status')
  detailView.unmount()
}

function expectDeleted() {
  expect(
    screen.queryByRole('link', { name: 'u1@example.com' })
  ).not.toBeInTheDocument()
  expect(screen.getByText('1 user')).toBeInTheDocument()
}

async function expectAdjusted() {
  const row = (
    await screen.findByRole('link', { name: 'u1@example.com' })
  ).closest('tr')!
  await waitFor(() => expect(within(row).getByText('550')).toBeInTheDocument())
  expect(within(row).getByText('50')).toBeInTheDocument()
  expect(within(row).getByText('900')).toBeInTheDocument()
}

beforeEach(() => {
  jest.clearAllMocks()
  mockList.mockResolvedValue(page(rowsBefore))
  mockGetUser.mockResolvedValue({ success: true, data: detail() })
  mockLedger.mockResolvedValue({
    success: true,
    data: { success: true, transactions: [], next: '' },
  })
  mockDelete.mockResolvedValue({ success: true })
  mockAdjust.mockResolvedValue({
    success: true,
    data: { success: true, balance: 550 },
  })
  jest.spyOn(window, 'confirm').mockReturnValue(true)
})

it('drops a deleted user and updates the count when the list is reopened', async () => {
  const client = newClient()
  await warmList(client)
  await deleteThroughDetail(client)

  mockList.mockResolvedValue(page(rowsAfterDelete))
  renderIn(client, <AdminUsersPage />)

  await screen.findByRole('link', { name: 'u2@example.com' })
  await waitFor(expectDeleted)
})

it('shows the new balance and gifted total after an adjustment', async () => {
  const client = newClient()
  await warmList(client)
  await adjustThroughDetail(client)

  mockList.mockResolvedValue(page(rowsAfterAdjust))
  renderIn(client, <AdminUsersPage />)

  await expectAdjusted()
})

it('keeps a list request started before the delete from freshening the old rows', async () => {
  const client = newClient()
  await warmList(client)

  const held = deferred<ReturnType<typeof page>>()
  mockList.mockReturnValueOnce(held.promise)
  void client.refetchQueries({ queryKey: ['admin-users'] })
  await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2))

  await deleteThroughDetail(client)
  await act(async () => {
    held.resolve(page(rowsBefore))
  })

  mockList.mockResolvedValue(page(rowsAfterDelete))
  renderIn(client, <AdminUsersPage />)

  await screen.findByRole('link', { name: 'u2@example.com' })
  await waitFor(expectDeleted)
})

it('keeps a list request started before an adjustment from freshening the old rows', async () => {
  const client = newClient()
  await warmList(client)

  const held = deferred<ReturnType<typeof page>>()
  mockList.mockReturnValueOnce(held.promise)
  void client.refetchQueries({ queryKey: ['admin-users'] })
  await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2))

  await adjustThroughDetail(client)
  await act(async () => {
    held.resolve(page(rowsBefore))
  })

  mockList.mockResolvedValue(page(rowsAfterAdjust))
  renderIn(client, <AdminUsersPage />)

  await expectAdjusted()
})

it("clears every cached ledger direction of the deleted user and keeps other users'", async () => {
  const client = newClient()
  for (const d of ['', 'in', 'out']) {
    client.setQueryData(['admin-user-ledger', 'u1', d], { pages: [] })
  }
  client.setQueryData(['admin-user-ledger', 'u2', ''], { pages: [] })

  await deleteThroughDetail(client)

  expect(
    client.getQueryCache().findAll({ queryKey: ['admin-user-ledger', 'u1'] })
  ).toHaveLength(0)
  expect(
    client.getQueryCache().findAll({ queryKey: ['admin-user', 'u1'] })
  ).toHaveLength(0)
  expect(
    client.getQueryCache().findAll({ queryKey: ['admin-user-ledger', 'u2'] })
  ).toHaveLength(1)
})
