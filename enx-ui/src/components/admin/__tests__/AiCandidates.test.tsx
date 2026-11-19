import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import AiCandidates from '../AiCandidates'
import { apiService } from '@/services/api'
import type { AdminAiCandidate } from '@/types'

jest.mock('@/services/api', () => ({
  apiService: {
    adminListAiCandidates: jest.fn(),
    adminReviewAiCandidate: jest.fn(),
  },
}))

const list = apiService.adminListAiCandidates as jest.Mock
const review = apiService.adminReviewAiCandidate as jest.Mock

const candidate = (over: Partial<AdminAiCandidate> = {}): AdminAiCandidate => ({
  english: 'rizzler',
  chinese: 'n. 很有魅力的人',
  quality: 5,
  promptVersion: 'v1',
  status: 'pending',
  hitCount: 7,
  firstHitAt: 1700000000000,
  lastHitAt: 1700000100000,
  ...over,
})

const page = (candidates: AdminAiCandidate[], total = candidates.length) => ({
  success: true,
  data: { candidates, total },
})

function renderList() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <AiCandidates />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  jest.resetAllMocks()
})

it('lists pending candidates with definition, quality and hit count', async () => {
  list.mockResolvedValue(page([candidate()]))
  renderList()

  expect(await screen.findByText('rizzler')).toBeInTheDocument()
  expect(screen.getByText('n. 很有魅力的人')).toBeInTheDocument()
  expect(screen.getByText(/quality 5\/10/)).toBeInTheDocument()
  expect(screen.getByText(/7 hits/)).toBeInTheDocument()
  expect(list).toHaveBeenCalledWith('pending', 25, 0)
})

it('says so when there are no candidates', async () => {
  list.mockResolvedValue(page([]))
  renderList()

  expect(await screen.findByText('No pending candidates.')).toBeInTheDocument()
})

it('reports a failure to load', async () => {
  list.mockResolvedValue({ success: false, error: 'Forbidden' })
  renderList()

  expect(await screen.findByText('Forbidden')).toBeInTheDocument()
})

it('approves a candidate and reads the list again', async () => {
  list.mockResolvedValue(page([candidate()]))
  review.mockResolvedValue({ success: true, data: { ok: true, created: true } })
  renderList()
  await screen.findByText('rizzler')

  fireEvent.click(screen.getByRole('button', { name: 'Approve' }))

  await waitFor(() =>
    expect(review).toHaveBeenCalledWith('rizzler', 'approve')
  )
  await waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(1))
})

it('rejects a candidate', async () => {
  list.mockResolvedValue(page([candidate()]))
  review.mockResolvedValue({ success: true, data: { ok: true } })
  renderList()
  await screen.findByText('rizzler')

  fireEvent.click(screen.getByRole('button', { name: 'Reject' }))

  await waitFor(() => expect(review).toHaveBeenCalledWith('rizzler', 'reject'))
})

it('shows the server message when a review fails', async () => {
  list.mockResolvedValue(page([candidate()]))
  review.mockResolvedValue({ success: false, error: 'not found' })
  renderList()
  await screen.findByText('rizzler')

  fireEvent.click(screen.getByRole('button', { name: 'Approve' }))

  expect(await screen.findByRole('alert')).toHaveTextContent('not found')
})

it('switches to rejected candidates, which offer Un-reject', async () => {
  list
    .mockResolvedValueOnce(page([candidate()]))
    .mockResolvedValue(
      page([candidate({ english: 'doomscroll', status: 'rejected' })])
    )
  review.mockResolvedValue({ success: true, data: { ok: true } })
  renderList()
  await screen.findByText('rizzler')

  fireEvent.click(screen.getByRole('tab', { name: 'Rejected' }))

  expect(await screen.findByText('doomscroll')).toBeInTheDocument()
  expect(list).toHaveBeenLastCalledWith('rejected', 25, 0)
  expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: 'Un-reject' }))
  await waitFor(() =>
    expect(review).toHaveBeenCalledWith('doomscroll', 'unreject')
  )
})

it('pages through a long list', async () => {
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) => candidate({ english: `word${i}` }))
  list.mockImplementation(async (_status, _limit, offset) =>
    offset === 0 ? page(many(25), 30) : page(many(5), 30)
  )
  renderList()
  await screen.findByText('word0')

  expect(screen.getByText('Showing 1–25 of 30')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()

  fireEvent.click(screen.getByRole('button', { name: 'Next' }))

  expect(await screen.findByText('Showing 26–30 of 30')).toBeInTheDocument()
  expect(list).toHaveBeenLastCalledWith('pending', 25, 25)
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
})
