import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import InvitePage from '../page'
import { apiService } from '@/services/api'

jest.mock('@/services/api', () => ({
  apiService: { getReferralMe: jest.fn() },
}))

const api = apiService as jest.Mocked<typeof apiService>
const LINK = 'https://catglish.com/invite/ABCDEFGH'

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <InvitePage />
    </QueryClientProvider>
  )
}

const writeText = jest.fn()

beforeEach(() => {
  jest.resetAllMocks()
  Object.assign(navigator, { clipboard: { writeText } })
  writeText.mockResolvedValue(undefined)
  api.getReferralMe.mockResolvedValue({
    success: true,
    data: {
      code: 'ABCDEFGH',
      link: LINK,
      invited: 3,
      paid: 2,
      pendingRewards: [
        { amount: 300, dueAt: Date.UTC(2026, 9, 20, 12) / 1000 },
        { amount: 60, dueAt: Date.UTC(2026, 10, 2, 12) / 1000 },
      ],
      totalEarned: 1260,
    },
  })
})

it('shows the invite link and copies it', async () => {
  renderPage()

  const input = await screen.findByLabelText('Your invite link')
  expect(input).toHaveValue(LINK)

  fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))
  expect(writeText).toHaveBeenCalledWith(LINK)
  expect(
    await screen.findByRole('button', { name: 'Copied' })
  ).toBeInTheDocument()
})

it('shows invited and paid counts and the total earned', async () => {
  renderPage()
  await screen.findByLabelText('Your invite link')

  expect(screen.getByTestId('invite-stat-invited')).toHaveTextContent('3')
  expect(screen.getByTestId('invite-stat-paid')).toHaveTextContent('2')
  expect(screen.getByTestId('invite-stat-earned')).toHaveTextContent('1,260')
})

it('lists pending rewards with their expected dates', async () => {
  renderPage()
  expect(
    await screen.findByText('300 credits · expected Oct 20')
  ).toBeInTheDocument()
  expect(screen.getByText('60 credits · expected Nov 2')).toBeInTheDocument()
})

it('says so when no reward is pending', async () => {
  api.getReferralMe.mockResolvedValue({
    success: true,
    data: {
      code: 'ABCDEFGH',
      link: LINK,
      invited: 0,
      paid: 0,
      pendingRewards: [],
      totalEarned: 0,
    },
  })
  renderPage()
  expect(await screen.findByText('No pending rewards.')).toBeInTheDocument()
})

it('shows the error when the invites fail to load', async () => {
  api.getReferralMe.mockResolvedValue({
    success: false,
    error: 'failed to load your invites',
  })
  renderPage()
  await waitFor(() =>
    expect(screen.getByText('failed to load your invites')).toBeInTheDocument()
  )
})
