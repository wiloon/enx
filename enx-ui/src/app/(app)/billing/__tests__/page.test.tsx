import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import BillingPage from '../page'
import { apiService } from '@/services/api'

jest.mock('@/services/api', () => ({
  apiService: {
    getBillingMe: jest.fn(),
    createSubscriptionCheckout: jest.fn(),
    createTopupCheckout: jest.fn(),
    createPortalSession: jest.fn(),
  },
}))

const api = apiService as jest.Mocked<typeof apiService>

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <BillingPage />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  jest.resetAllMocks()
  api.getBillingMe.mockResolvedValue({
    success: true,
    data: {
      subscription: { status: 'none', plan: '', currentPeriodEnd: 0 },
      credits: {
        subscriptionBalance: 0,
        topupBalance: 0,
        trialBalance: 0,
        trialExpiresAt: null,
      },
    },
  })
})

it('shows the monthly subscription tab by default', async () => {
  renderPage()

  expect(
    screen.getByRole('tab', { name: 'Monthly subscription' })
  ).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('tab', { name: 'One-time credits' })).toHaveAttribute(
    'aria-selected',
    'false'
  )
  expect(screen.getAllByRole('button', { name: 'Subscribe' })).toHaveLength(3)
  expect(screen.queryByRole('button', { name: 'Buy' })).toBeNull()
  await waitFor(() => expect(screen.getByText('Free user')).toBeInTheDocument())
})

it('switches to one-time credits, which a free user can buy', async () => {
  api.createTopupCheckout.mockResolvedValue({
    success: false,
    error: 'stop before redirect',
  })
  renderPage()
  await waitFor(() => expect(screen.getByText('Free user')).toBeInTheDocument())

  fireEvent.click(screen.getByRole('tab', { name: 'One-time credits' }))

  expect(screen.getByRole('tab', { name: 'One-time credits' })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  expect(screen.queryByRole('button', { name: 'Subscribe' })).toBeNull()
  const buyButtons = screen.getAllByRole('button', { name: 'Buy' })
  expect(buyButtons).toHaveLength(3)
  buyButtons.forEach((b) => expect(b).toBeEnabled())

  fireEvent.click(buyButtons[0])
  expect(api.createTopupCheckout).toHaveBeenCalledWith('small')
  expect(await screen.findByText('stop before redirect')).toBeInTheDocument()
})

it('shows the sign-up trial and when it expires', async () => {
  const expires = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60
  api.getBillingMe.mockResolvedValue({
    success: true,
    data: {
      subscription: { status: 'none', plan: '', currentPeriodEnd: 0 },
      credits: {
        subscriptionBalance: 0,
        topupBalance: 0,
        trialBalance: 100,
        trialExpiresAt: expires,
      },
    },
  })
  renderPage()

  expect(
    await screen.findByText(/^100 trial credits · expires /)
  ).toBeInTheDocument()
})
