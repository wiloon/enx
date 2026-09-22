import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import AdminPageReportsPage from '../page'
import { apiService } from '@/services/api'

jest.mock('@/services/api', () => ({
  apiService: {
    adminListPageReports: jest.fn(),
  },
}))

const mockList = apiService.adminListPageReports as jest.Mock

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <AdminPageReportsPage />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  jest.clearAllMocks()
})

it('lists page reports from the admin API', async () => {
  mockList.mockResolvedValue({
    success: true,
    data: {
      success: true,
      reports: [
        {
          id: 'r1',
          userId: 'u1',
          url: 'https://x.com/a/status/1',
          host: 'x.com',
          reason: 'no-article-node',
          adapter: 'x',
          extVersion: '1.2.3',
          createdAt: Date.UTC(2026, 8, 21, 12, 0, 0),
        },
      ],
    },
  })

  renderPage()

  await waitFor(() => {
    expect(screen.getByText('x.com')).toBeInTheDocument()
  })
  expect(screen.getByText('no-article-node')).toBeInTheDocument()
  expect(screen.getByText('https://x.com/a/status/1')).toBeInTheDocument()
  expect(screen.getByText('1 report(s)')).toBeInTheDocument()
})

it('shows an empty state when there are no reports', async () => {
  mockList.mockResolvedValue({
    success: true,
    data: { success: true, reports: [] },
  })

  renderPage()

  await waitFor(() => {
    expect(screen.getByText('No page reports yet.')).toBeInTheDocument()
  })
})
