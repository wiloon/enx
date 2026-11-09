import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import AdminFeedbackPage from '../page'
import { apiService } from '@/services/api'
import type { AdminFeedback } from '@/types'

jest.mock('@/services/api', () => ({
  apiService: {
    adminListFeedback: jest.fn(),
    adminResolveFeedback: jest.fn(),
  },
}))

const mockList = apiService.adminListFeedback as jest.Mock
const mockResolve = apiService.adminResolveFeedback as jest.Mock

function record(overrides: Partial<AdminFeedback> = {}): AdminFeedback {
  return {
    id: 'f1',
    userId: 'u1',
    kind: 'page_report',
    url: 'https://x.com/a/status/1',
    host: 'x.com',
    text: '',
    context: { adapter: 'x', extVersion: '1.2.3' },
    details: { reason: 'no-article-node' },
    status: 'new',
    createdAt: Date.UTC(2026, 10, 9, 12, 0, 0),
    ...overrides,
  }
}

function page(feedback: AdminFeedback[], nextOffset: number | null = null) {
  return { success: true, data: { success: true, feedback, nextOffset } }
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <AdminFeedbackPage />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  jest.clearAllMocks()
})

it('lists feedback newest first from the first page, linking each user to their page', async () => {
  mockList.mockResolvedValue(
    page([
      record({ id: 'f2', userId: 'u2', url: 'https://x.com/b', host: 'x.com' }),
      record(),
    ])
  )

  renderPage()

  const rows = await screen.findAllByRole('row')
  expect(rows).toHaveLength(3)
  expect(within(rows[1]).getByText('https://x.com/b')).toBeInTheDocument()
  expect(within(rows[1]).getByRole('link', { name: 'u2' })).toHaveAttribute(
    'href',
    '/admin/users/u2'
  )
  expect(
    within(rows[2]).getByText('https://x.com/a/status/1')
  ).toBeInTheDocument()
  expect(within(rows[2]).getByText('Page report')).toBeInTheDocument()
  expect(
    within(rows[2]).getByText('reason: no-article-node')
  ).toBeInTheDocument()
  expect(
    within(rows[2]).getByText('adapter: x · extVersion: 1.2.3')
  ).toBeInTheDocument()
  expect(mockList).toHaveBeenCalledWith({
    kind: '',
    status: '',
    limit: 100,
    offset: 0,
  })
})

it('asks the server for the chosen kind and status and shows what it returns', async () => {
  mockList.mockResolvedValue(page([record()]))
  renderPage()
  await screen.findByText('https://x.com/a/status/1')

  mockList.mockResolvedValue(
    page([
      record({
        id: 'f9',
        status: 'resolved',
        url: 'https://example.com/resolved',
        host: 'example.com',
      }),
    ])
  )
  fireEvent.change(screen.getByLabelText('Kind'), {
    target: { value: 'page_report' },
  })
  fireEvent.change(screen.getByLabelText('Status'), {
    target: { value: 'resolved' },
  })

  expect(
    await screen.findByText('https://example.com/resolved')
  ).toBeInTheDocument()
  expect(mockList).toHaveBeenLastCalledWith({
    kind: 'page_report',
    status: 'resolved',
    limit: 100,
    offset: 0,
  })
  expect(screen.queryByText('https://x.com/a/status/1')).toBeNull()
})

it('pages through every record with the offset the server returns', async () => {
  mockList.mockImplementation(async ({ offset }: { offset: number }) =>
    offset === 0
      ? page([record({ id: 'first', url: 'https://x.com/first' })], 100)
      : page([record({ id: 'last', url: 'https://x.com/last' })], null)
  )

  renderPage()
  await screen.findByText('https://x.com/first')
  expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()

  fireEvent.click(screen.getByRole('button', { name: 'Next' }))

  expect(await screen.findByText('https://x.com/last')).toBeInTheDocument()
  expect(mockList).toHaveBeenLastCalledWith({
    kind: '',
    status: '',
    limit: 100,
    offset: 100,
  })
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()

  fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
  expect(await screen.findByText('https://x.com/first')).toBeInTheDocument()
})

it('marks a record resolved and reloads the list', async () => {
  mockList.mockResolvedValueOnce(page([record()]))
  mockList.mockResolvedValue(page([record({ status: 'resolved' })]))
  mockResolve.mockResolvedValue({ success: true, data: { success: true } })

  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: 'Resolve' }))

  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Resolve' })).toBeNull()
  )
  expect(mockResolve).toHaveBeenCalledWith('f1')
  expect(
    within(screen.getAllByRole('row')[1]).getByText('Resolved')
  ).toBeInTheDocument()
})

it('shows the error when resolving fails', async () => {
  mockList.mockResolvedValue(page([record()]))
  mockResolve.mockResolvedValue({ success: false, error: 'no such feedback' })

  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: 'Resolve' }))

  expect(await screen.findByRole('alert')).toHaveTextContent('no such feedback')
})

it('shows an empty state when nothing matches', async () => {
  mockList.mockResolvedValue(page([]))

  renderPage()

  expect(await screen.findByText('No feedback matches.')).toBeInTheDocument()
})
