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

it('makes Subscribe the brand button and marks the selected tab in brand', async () => {
  renderPage()
  await waitFor(() => expect(screen.getByText('Free user')).toBeInTheDocument())

  screen
    .getAllByRole('button', { name: 'Subscribe' })
    .forEach((b) => expect(b).toHaveClass('bg-brand'))
  expect(screen.getByRole('tab', { name: 'Monthly subscription' })).toHaveClass(
    'text-brand'
  )
  expect(screen.getByRole('tab', { name: 'One-time credits' })).not.toHaveClass(
    'text-brand'
  )

  fireEvent.click(screen.getByRole('tab', { name: 'One-time credits' }))

  expect(screen.getByRole('tab', { name: 'One-time credits' })).toHaveClass(
    'text-brand'
  )
  expect(
    screen.getByRole('tab', { name: 'Monthly subscription' })
  ).not.toHaveClass('text-brand')
})

it('shows an active subscription with a brand badge', async () => {
  api.getBillingMe.mockResolvedValue({
    success: true,
    data: {
      subscription: { status: 'active', plan: 'pro', currentPeriodEnd: 0 },
      credits: {
        subscriptionBalance: 0,
        topupBalance: 0,
        trialBalance: 0,
        trialExpiresAt: null,
      },
    },
  })
  renderPage()

  const badge = await screen.findByText(/Pro/, {
    selector: '[data-slot=badge]',
  })
  expect(badge).toHaveClass('bg-brand')
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

describe.each(['past_due', 'trialing'])(
  'a user whose subscription is %s',
  (status) => {
    beforeEach(() => {
      api.getBillingMe.mockResolvedValue({
        success: true,
        data: {
          subscription: { status, plan: 'pro', currentPeriodEnd: 0 },
          credits: {
            subscriptionBalance: 0,
            topupBalance: 0,
            trialBalance: 0,
            trialExpiresAt: null,
          },
        },
      })
    })

    it('cannot start a second subscription', async () => {
      renderPage()

      const buttons = await screen.findAllByRole('button', {
        name: 'Subscribed',
      })
      expect(buttons).toHaveLength(3)
      buttons.forEach((b) => expect(b).toBeDisabled())
      expect(screen.queryByRole('button', { name: 'Subscribe' })).toBeNull()
    })

    it('can manage the subscription in the billing portal', async () => {
      renderPage()

      expect(
        await screen.findByRole('button', {
          name: 'Manage subscription / billing',
        })
      ).toBeEnabled()
    })
  }
)

function respondWithStatus(status: string) {
  api.getBillingMe.mockResolvedValue({
    success: true,
    data: {
      subscription: { status, plan: 'pro', currentPeriodEnd: 0 },
      credits: {
        subscriptionBalance: 0,
        topupBalance: 0,
        trialBalance: 0,
        trialExpiresAt: null,
      },
    },
  })
}

it('says a trialing subscription is starting, not a free user', async () => {
  respondWithStatus('trialing')
  renderPage()

  expect(
    await screen.findByText('Subscription starting', {
      selector: '[data-slot=badge]',
    })
  ).toBeInTheDocument()
  expect(screen.queryByText('Free user')).toBeNull()
  const buttons = screen.getAllByRole('button', { name: 'Subscribed' })
  expect(buttons).toHaveLength(3)
  buttons.forEach((b) => expect(b).toBeDisabled())
})

it.each([
  ['trialing', 'Subscription starting', 'bg-secondary'],
  ['incomplete', 'Payment incomplete', 'bg-destructive'],
  ['unpaid', 'Subscription unpaid', 'bg-destructive'],
])(
  'shows a %s subscription as %j with a %s badge',
  async (status, label, badgeClass) => {
    respondWithStatus(status)
    renderPage()

    const badge = await screen.findByText(label, {
      selector: '[data-slot=badge]',
    })
    expect(badge).toHaveClass(badgeClass)
  }
)

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
