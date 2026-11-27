import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import AccountPage from '../page'
import { apiService } from '@/services/api'
import type { BillingMeData, MeData, ReferralMeData } from '@/types'

jest.mock('@/services/api', () => ({
  apiService: {
    getMe: jest.fn(),
    getBillingMe: jest.fn(),
    getReferralMe: jest.fn(),
  },
}))

jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ isAuthenticated: true, isLoading: false }),
}))

const api = apiService as jest.Mocked<typeof apiService>

const AVATAR = 'https://img.clerk.com/alice.png'
const INVITE = 'https://catglish.app/r/ALICE42'

const me: MeData = {
  id: 'u_42',
  name: 'Alice Smith',
  email: 'alice@example.com',
  status: 'active',
  isAdmin: false,
  avatarUrl: AVATAR,
  createdAt: '2026-03-04T10:00:00Z',
}

const billing: BillingMeData = {
  subscription: { status: 'active', plan: 'pro', currentPeriodEnd: 0 },
  credits: {
    subscriptionBalance: 1000,
    topupBalance: 200,
    trialBalance: 50,
    trialExpiresAt: null,
  },
}

const referral: ReferralMeData = {
  code: 'ALICE42',
  link: INVITE,
  invited: 0,
  paid: 0,
  pendingRewards: [],
  totalEarned: 0,
}

const writeText = jest.fn()

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <AccountPage />
    </QueryClientProvider>
  )
}

const card = (title: string) =>
  screen
    .getByRole('heading', { name: title })
    .closest<HTMLElement>('[data-slot="card"]')!

beforeEach(() => {
  jest.resetAllMocks()
  api.getMe.mockResolvedValue({ success: true, data: me })
  api.getBillingMe.mockResolvedValue({ success: true, data: billing })
  api.getReferralMe.mockResolvedValue({ success: true, data: referral })
  writeText.mockResolvedValue(undefined)
  Object.assign(navigator, { clipboard: { writeText } })
})

it('shows the profile: avatar, name, email and join date', async () => {
  renderPage()

  expect(await screen.findByText('alice@example.com')).toBeInTheDocument()
  const profile = within(card('Profile'))
  expect(profile.getByText('Alice Smith')).toBeInTheDocument()
  expect(profile.getByText('Joined March 4, 2026')).toBeInTheDocument()
  expect(card('Profile').querySelector('img')).toHaveAttribute('src', AVATAR)
})

it('shows the enx user ID for support and copies it', async () => {
  renderPage()

  expect(await screen.findByText('u_42')).toBeInTheDocument()
  const id = within(card('Account ID'))
  expect(id.getByText(/share this with support/i)).toBeInTheDocument()

  await act(async () => {
    fireEvent.click(id.getByRole('button', { name: 'Copy account ID' }))
  })
  expect(writeText).toHaveBeenCalledWith('u_42')
  expect(id.getByRole('button', { name: 'Copy account ID' })).toHaveTextContent(
    'Copied'
  )
})

it('summarises the plan and credits and links to Billing', async () => {
  renderPage()

  expect(await screen.findByText('Pro member')).toBeInTheDocument()
  const plan = within(card('Plan & credits'))
  expect(plan.getByText('1,250 credits')).toBeInTheDocument()
  expect(plan.getByRole('link', { name: /billing/i })).toHaveAttribute(
    'href',
    '/billing'
  )
})

it('shows the invite link, copies it and links to the invite page', async () => {
  renderPage()

  const invite = within(card('Invite friends'))
  expect(await invite.findByDisplayValue(INVITE)).toHaveAttribute('readonly')

  await act(async () => {
    fireEvent.click(invite.getByRole('button', { name: 'Copy link' }))
  })
  expect(writeText).toHaveBeenCalledWith(INVITE)
  expect(invite.getByRole('link', { name: /invites/i })).toHaveAttribute(
    'href',
    '/invite'
  )
})

// Changing the name, email or picture happens in Clerk's own UI; this page
// only shows the account (#211).
it('is read-only', async () => {
  renderPage()

  await screen.findByText('u_42')
  await screen.findByDisplayValue(INVITE)
  expect(
    screen.queryByRole('button', { name: /manage account|edit/i })
  ).not.toBeInTheDocument()
  for (const box of screen.queryAllByRole('textbox')) {
    expect(box).toHaveAttribute('readonly')
  }
})

it('keeps the other cards when billing fails to load', async () => {
  api.getBillingMe.mockResolvedValue({ success: false, error: 'boom' })
  renderPage()

  expect(await screen.findByText('u_42')).toBeInTheDocument()
  expect(
    await within(card('Plan & credits')).findByText('boom')
  ).toBeInTheDocument()
  expect(
    within(card('Plan & credits')).getByRole('link', { name: /billing/i })
  ).toHaveAttribute('href', '/billing')
})

it('says so when the account fails to load', async () => {
  api.getMe.mockResolvedValue({ success: false, error: 'Unauthorized' })
  renderPage()

  expect(await screen.findByText('Unauthorized')).toBeInTheDocument()
})
