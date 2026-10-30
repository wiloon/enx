import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import BillingPage from '../page'
import { apiService } from '@/services/api'

jest.mock('@/services/api', () => ({
  apiService: {
    getBillingMe: jest.fn(),
    createSubscriptionCheckout: jest.fn(),
    createTopupCheckout: jest.fn(),
    createPortalSession: jest.fn(),
    createPlanChangeSession: jest.fn(),
    submitBillingSupport: jest.fn(),
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

describe.each(['past_due', 'trialing', 'incomplete', 'unpaid'])(
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

    it('opens Portal home from every tier instead of starting a second subscription', async () => {
      api.createPortalSession.mockResolvedValue({
        success: false,
        error: 'Portal unavailable',
      })
      renderPage()

      const buttons = await screen.findAllByRole('button', {
        name: 'Manage subscription',
      })
      expect(buttons).toHaveLength(3)
      buttons.forEach((b) => expect(b).toBeEnabled())
      expect(screen.queryByRole('button', { name: 'Subscribe' })).toBeNull()
      for (const button of buttons) {
        fireEvent.click(button)
        await screen.findByText('Portal unavailable')
        await waitFor(() => expect(button).toBeEnabled())
      }
      expect(api.createPortalSession).toHaveBeenCalledTimes(3)
      expect(api.createSubscriptionCheckout).not.toHaveBeenCalled()
      expect(api.createPlanChangeSession).not.toHaveBeenCalled()
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
  const buttons = screen.getAllByRole('button', { name: 'Manage subscription' })
  expect(buttons).toHaveLength(3)
  buttons.forEach((b) => expect(b).toBeEnabled())
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

it('keeps the current tier disabled and opens plan changes for the selected other tier', async () => {
  respondWithStatus('active')
  api.createPlanChangeSession.mockResolvedValue({
    success: false,
    error: 'Plan change unavailable',
  })
  renderPage()
  const current = await screen.findByRole('button', { name: 'Current plan' })
  expect(current).toBeDisabled()
  fireEvent.click(current)
  expect(api.createPlanChangeSession).not.toHaveBeenCalled()
  const max = screen
    .getByText('Catglish Max')
    .closest('[data-slot="card"]') as HTMLElement
  fireEvent.click(within(max).getByRole('button', { name: 'Change plan' }))
  expect(api.createPlanChangeSession).toHaveBeenCalledWith('max')
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Plan change unavailable'
  )
})

describe.each(['checkout', 'change'] as const)(
  '%s conflict hand-off',
  (path) => {
    function conflict(subscriptionId?: string) {
      return {
        success: false as const,
        status: 409,
        reason: 'subscription_conflict',
        subscriptionId,
        error: 'Contact billing support',
      }
    }

    async function start() {
      respondWithStatus(path === 'change' ? 'active' : 'canceled')
      renderPage()
      await screen.findByText(path === 'change' ? 'Pro member' : 'Canceled')
      await act(async () => {
        fireEvent.click(
          screen.getAllByRole('button', {
            name: path === 'change' ? 'Change plan' : 'Subscribe',
          })[0]
        )
      })
    }

    beforeEach(() => {
      api.createSubscriptionCheckout.mockResolvedValue(conflict('sub_blocking'))
      api.createPlanChangeSession.mockResolvedValue(conflict('sub_blocking'))
    })

    it('submits the server blocking conflict ID and the message through the real form', async () => {
      api.submitBillingSupport.mockResolvedValue({
        success: false,
        error: 'Support unavailable',
      })
      await start()
      const input = await screen.findByRole('textbox', {
        name: 'Message to support',
      })
      fireEvent.change(input, {
        target: { value: 'Please investigate my subscription' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
      expect(api.submitBillingSupport).toHaveBeenCalledWith(
        'sub_blocking',
        'Please investigate my subscription'
      )
      expect(await screen.findByText('Support unavailable')).toBeInTheDocument()
    })
    it.each([undefined, ''])(
      'keeps the error without support for conflict ID %j',
      async (id) => {
        api.createSubscriptionCheckout.mockResolvedValue(conflict(id))
        api.createPlanChangeSession.mockResolvedValue(conflict(id))
        await start()
        expect(screen.getByText('Contact billing support')).toBeInTheDocument()
        expect(screen.queryByRole('textbox')).toBeNull()
      }
    )

    it.each([
      { status: 409, reason: 'deletion_in_progress' },
      { status: 503, reason: 'subscription_conflict' },
    ])('keeps unrelated failure %j out of support', async (failure) => {
      const response = { ...conflict('sub_blocking'), ...failure }
      api.createSubscriptionCheckout.mockResolvedValue(response)
      api.createPlanChangeSession.mockResolvedValue(response)
      await start()
      expect(screen.getByText('Contact billing support')).toBeInTheDocument()
      expect(screen.queryByRole('textbox')).toBeNull()
    })

    it.each(['draft', 'success'])(
      'clears the old %s when the blocking conflict changes',
      async (state) => {
        api.submitBillingSupport.mockResolvedValue({
          success: true,
          data: {
            message: 'Support received',
            supportRequest: {
              message: 'Old message',
              sentAt: '2026-10-29T12:00:00Z',
            },
          },
        })
        await start()
        fireEvent.change(screen.getByRole('textbox'), {
          target: { value: 'Old message' },
        })
        if (state === 'success') {
          fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
          await screen.findByText('Support received')
        }
        api.createSubscriptionCheckout.mockResolvedValue(conflict('sub_next'))
        api.createPlanChangeSession.mockResolvedValue(conflict('sub_next'))
        await act(async () => {
          fireEvent.click(
            screen.getAllByRole('button', {
              name: path === 'change' ? 'Change plan' : 'Subscribe',
            })[0]
          )
        })
        expect(screen.getByRole('textbox')).toHaveValue('')
        expect(screen.queryByText('Support received')).toBeNull()
        fireEvent.change(screen.getByRole('textbox'), {
          target: { value: 'New message' },
        })
        fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
        await screen.findByText('Support received')
        expect(api.submitBillingSupport).toHaveBeenLastCalledWith(
          'sub_next',
          'New message'
        )
      }
    )
  }
)

it.each([
  ['Catglish Pro', 'pro'],
  ['Catglish Pro+', 'pro-plus'],
  ['Catglish Max', 'max'],
])(
  'starts subscription Checkout for %s with its selected tier',
  async (name, tier) => {
    api.createSubscriptionCheckout.mockResolvedValue({
      success: false,
      error: 'Checkout unavailable',
    })
    renderPage()
    await screen.findByText('Free user')
    const card = screen
      .getByText(name)
      .closest('[data-slot="card"]') as HTMLElement
    fireEvent.click(within(card).getByRole('button', { name: 'Subscribe' }))
    expect(await screen.findByText('Checkout unavailable')).toBeInTheDocument()
    expect(api.createSubscriptionCheckout).toHaveBeenCalledWith(tier)
  }
)
