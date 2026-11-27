import { render, screen, within } from '@testing-library/react'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import AdminFunnelPage from '../page'
import { apiService } from '@/services/api'
import type { AdminFunnelCohort } from '@/types'

jest.mock('@/services/api', () => ({
  apiService: {
    adminGetFunnel: jest.fn(),
  },
}))

const mockFunnel = apiService.adminGetFunnel as jest.Mock

const current: AdminFunnelCohort = {
  weekStart: '2026-11-23',
  signedUp: 12,
  firstLookup: 9,
  threeLookupDays: null,
  week2: null,
  week4: null,
  firstAiCall: 4,
  trialEnded: 1,
  firstPayment: 0,
}

const empty: AdminFunnelCohort = {
  weekStart: '2026-10-05',
  signedUp: 0,
  firstLookup: 0,
  threeLookupDays: 0,
  week2: 0,
  week4: 0,
  firstAiCall: 0,
  trialEnded: 0,
  firstPayment: 0,
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <AdminFunnelPage />
    </QueryClientProvider>
  )
}

// The text of each cell in the week's row, left to right.
async function cells(weekStart: string) {
  const header = await screen.findByRole('rowheader', { name: weekStart })
  return within(header.closest('tr')!)
    .getAllByRole('cell')
    .map((cell) => cell.textContent)
}

beforeEach(() => {
  jest.clearAllMocks()
  mockFunnel.mockResolvedValue({
    success: true,
    data: { success: true, cohorts: [current, empty] },
  })
})

it('has a column per step', async () => {
  renderPage()

  await screen.findByRole('table')
  expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(
    [
      'Week of',
      'Signed up',
      'First lookup',
      '3 lookup days',
      'Week 2',
      'Week 4',
      'First AI call',
      'Trial ended',
      'First payment',
    ]
  )
})

it('shows each count with its share of sign-ups, and a dash while not measurable', async () => {
  renderPage()

  expect(await cells('2026-11-23')).toEqual([
    '12 100%',
    '9 75%',
    '—',
    '—',
    '—',
    '4 33%',
    '1 8%',
    '0 0%',
  ])
})

it('shows no percentages for a week without sign-ups', async () => {
  renderPage()

  expect(await cells('2026-10-05')).toEqual(Array(8).fill('0'))
})

it('explains every step and who is left out under the table', async () => {
  renderPage()

  await screen.findByRole('table')
  expect(screen.getAllByRole('term').map((term) => term.textContent)).toEqual([
    'Signed up',
    'First lookup',
    '3 lookup days',
    'Week 2',
    'Week 4',
    'First AI call',
    'Trial ended',
    'First payment',
  ])
  expect(
    screen.getByText('Admin accounts and deleted accounts are not counted.')
  ).toBeInTheDocument()
})

it('shows the API error', async () => {
  mockFunnel.mockResolvedValue({
    success: false,
    error: 'admin access required',
  })
  renderPage()

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'admin access required'
  )
})
