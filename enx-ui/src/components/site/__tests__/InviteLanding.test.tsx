import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import InviteLanding from '../InviteLanding'
import { apiService } from '@/services/api'
import { REFERRAL_STORED_EVENT, readReferralCode } from '@/lib/referral'

jest.mock('@/services/api', () => ({
  apiService: { getReferralOffer: jest.fn() },
}))

const mockUseAuth = jest.fn()
jest.mock('@/hooks/useAuth', () => ({ useAuth: () => mockUseAuth() }))

jest.mock('@/hooks/useExtensionStatus', () => ({
  useExtensionStatus: () => 'unknown',
}))

const api = apiService as jest.Mocked<typeof apiService>

function renderLanding(code = 'ABCDEFGH') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <InviteLanding code={code} />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  jest.resetAllMocks()
  window.localStorage.clear()
  mockUseAuth.mockReturnValue({ isAuthenticated: false, isLoading: false })
  api.getReferralOffer.mockResolvedValue({
    success: true,
    data: { credits: 150, days: 10 },
  })
})

it('stores the code for the claim after sign-in and tells the app', () => {
  const stored = jest.fn()
  window.addEventListener(REFERRAL_STORED_EVENT, stored)

  renderLanding('ABCDEFGH')

  expect(readReferralCode(window.localStorage)).toBe('ABCDEFGH')
  expect(stored).toHaveBeenCalledTimes(1)
  window.removeEventListener(REFERRAL_STORED_EVENT, stored)
})

it('shows the offer with the numbers from the API', async () => {
  renderLanding()
  expect(
    await screen.findByText(
      'Join via this link and get 150 free AI credits (valid for 10 days).'
    )
  ).toBeInTheDocument()
})

it('falls back to a plain invitation when the offer has no credits', async () => {
  api.getReferralOffer.mockResolvedValue({
    success: true,
    data: { credits: 0, days: 7 },
  })
  renderLanding()
  expect(
    await screen.findByText('Join Catglish via this link.')
  ).toBeInTheDocument()
})

it('leads a signed-out visitor to sign up and install the extension', () => {
  renderLanding()
  expect(screen.getByRole('link', { name: 'Sign up' })).toHaveAttribute(
    'href',
    '/sign-up'
  )
  expect(
    screen.getByRole('link', { name: 'Install the extension' })
  ).toBeInTheDocument()
})

it('sends a signed-in visitor to the app', () => {
  mockUseAuth.mockReturnValue({ isAuthenticated: true, isLoading: false })
  renderLanding()
  expect(screen.queryByRole('link', { name: 'Sign up' })).toBeNull()
  expect(screen.getByRole('link', { name: 'Go to app' })).toHaveAttribute(
    'href',
    '/app'
  )
})
