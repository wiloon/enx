import { fireEvent, render, screen } from '@testing-library/react'
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
    defaultOptions: { queries: { retry: false, staleTime: 5 * 60 * 1000 } },
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

it('shows the times of distinct hits on the same day', async () => {
  list.mockResolvedValue(page([candidate()]))
  renderList()

  const details = await screen.findByText(/7 hits/)
  expect(details).toHaveTextContent(
    `first ${new Date(1700000000000).toLocaleString()} · last ${new Date(1700000100000).toLocaleString()}`
  )
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

it('removes an approved candidate from the pending list', async () => {
  list.mockResolvedValueOnce(page([candidate()])).mockResolvedValue(page([]))
  review.mockResolvedValue({ success: true, data: { ok: true, created: true } })
  renderList()
  await screen.findByText('rizzler')

  fireEvent.click(screen.getByRole('button', { name: 'Approve' }))

  expect(await screen.findByText('No pending candidates.')).toBeInTheDocument()
  expect(screen.queryByText('rizzler')).not.toBeInTheDocument()
  expect(review).toHaveBeenCalledWith('rizzler', 'approve')
})

it('shows the server message when a review fails', async () => {
  list.mockResolvedValue(page([candidate()]))
  review.mockResolvedValue({ success: false, error: 'not found' })
  renderList()
  await screen.findByText('rizzler')

  fireEvent.click(screen.getByRole('button', { name: 'Approve' }))

  expect(await screen.findByRole('alert')).toHaveTextContent('not found')
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

it('reopens a page after its only candidate is rejected and un-rejected', async () => {
  const firstPage = Array.from({ length: 25 }, (_, i) =>
    candidate({ english: `word${i}` })
  )
  let rejected = false
  list.mockImplementation(async (status, _limit, offset) => {
    if (status === 'rejected') {
      return page(rejected ? [candidate({ status: 'rejected' })] : [])
    }
    const total = rejected ? 25 : 26
    return page(offset === 0 ? firstPage : rejected ? [] : [candidate()], total)
  })
  review.mockImplementation(async (_word, action) => {
    rejected = action === 'reject'
    return { success: true, data: { ok: true } }
  })
  renderList()

  await screen.findByText('Showing 1–25 of 26')
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  await screen.findByText('rizzler')
  fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
  expect(await screen.findByText('Showing 1–25 of 25')).toBeInTheDocument()
  expect(screen.queryByText('rizzler')).not.toBeInTheDocument()
  expect(review).toHaveBeenCalledWith('rizzler', 'reject')

  fireEvent.click(screen.getByRole('tab', { name: 'Rejected' }))
  expect(await screen.findByText('rizzler')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Un-reject' }))
  expect(await screen.findByText('No rejected candidates.')).toBeInTheDocument()
  expect(screen.queryByText('rizzler')).not.toBeInTheDocument()
  expect(review).toHaveBeenCalledWith('rizzler', 'unreject')

  fireEvent.click(screen.getByRole('tab', { name: 'Pending' }))
  await screen.findByText('Showing 1–25 of 26')
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  expect(await screen.findByText('Showing 26–26 of 26')).toBeInTheDocument()
  expect(screen.getByText('rizzler')).toBeInTheDocument()
})
