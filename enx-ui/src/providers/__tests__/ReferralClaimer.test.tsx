import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ReferralClaimer from '../ReferralClaimer'
import { apiService } from '@/services/api'
import {
  REFERRAL_STORAGE_KEY,
  REFERRAL_STORED_EVENT,
  storeReferralCode,
} from '@/lib/referral'

jest.mock('@/services/api', () => ({
  apiService: { claimReferral: jest.fn() },
}))

const mockUseAuth = jest.fn()
jest.mock('@/hooks/useAuth', () => ({ useAuth: () => mockUseAuth() }))

const api = apiService as jest.Mocked<typeof apiService>
const EXPIRES = Date.UTC(2026, 9, 15, 12) / 1000

function renderClaimer() {
  const client = new QueryClient()
  const invalidate = jest.spyOn(client, 'invalidateQueries')
  render(
    <QueryClientProvider client={client}>
      <ReferralClaimer />
    </QueryClientProvider>
  )
  return { invalidate }
}

beforeEach(() => {
  jest.resetAllMocks()
  window.localStorage.clear()
  mockUseAuth.mockReturnValue({ isAuthenticated: true, isLoading: false })
})

it('claims a stored code once signed in, clears it and shows the bonus', async () => {
  storeReferralCode(window.localStorage, 'ABCDEFGH')
  api.claimReferral.mockResolvedValue({
    success: true,
    data: { bonus: 100, trialExpiresAt: EXPIRES },
  })

  const { invalidate } = renderClaimer()

  expect(
    await screen.findByText(
      '+100 bonus credits from your invite · expires Oct 15'
    )
  ).toBeInTheDocument()
  expect(api.claimReferral).toHaveBeenCalledTimes(1)
  expect(api.claimReferral).toHaveBeenCalledWith('ABCDEFGH')
  expect(window.localStorage.getItem(REFERRAL_STORAGE_KEY)).toBeNull()
  // The balances on screen pick up the bonus.
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['billing-me'] })

  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
  expect(screen.queryByRole('status')).toBeNull()
})

it('clears the code and shows nothing when the claim is refused', async () => {
  storeReferralCode(window.localStorage, 'ABCDEFGH')
  jest.spyOn(console, 'info').mockImplementation(() => {})
  api.claimReferral.mockResolvedValue({
    success: false,
    error: 'This account has already claimed an invite.',
    status: 409,
  })

  renderClaimer()

  await waitFor(() => expect(api.claimReferral).toHaveBeenCalled())
  await waitFor(() =>
    expect(window.localStorage.getItem(REFERRAL_STORAGE_KEY)).toBeNull()
  )
  expect(screen.queryByRole('status')).toBeNull()
})

it('shows nothing when the claim granted no bonus', async () => {
  storeReferralCode(window.localStorage, 'ABCDEFGH')
  api.claimReferral.mockResolvedValue({
    success: true,
    data: { bonus: 0, trialExpiresAt: null },
  })

  renderClaimer()

  await waitFor(() => expect(api.claimReferral).toHaveBeenCalled())
  expect(window.localStorage.getItem(REFERRAL_STORAGE_KEY)).toBeNull()
  expect(screen.queryByRole('status')).toBeNull()
})

it('waits for sign-in', () => {
  mockUseAuth.mockReturnValue({ isAuthenticated: false, isLoading: false })
  storeReferralCode(window.localStorage, 'ABCDEFGH')

  renderClaimer()

  expect(api.claimReferral).not.toHaveBeenCalled()
  expect(window.localStorage.getItem(REFERRAL_STORAGE_KEY)).not.toBeNull()
})

it('does nothing without a stored code', async () => {
  renderClaimer()
  await act(async () => {})
  expect(api.claimReferral).not.toHaveBeenCalled()
})

it('claims a code the landing page stores while already signed in', async () => {
  api.claimReferral.mockResolvedValue({
    success: true,
    data: { bonus: 100, trialExpiresAt: EXPIRES },
  })
  renderClaimer()
  await act(async () => {})
  expect(api.claimReferral).not.toHaveBeenCalled()

  act(() => {
    storeReferralCode(window.localStorage, 'ABCDEFGH')
    window.dispatchEvent(new Event(REFERRAL_STORED_EVENT))
  })

  expect(
    await screen.findByText(
      '+100 bonus credits from your invite · expires Oct 15'
    )
  ).toBeInTheDocument()
  expect(api.claimReferral).toHaveBeenCalledWith('ABCDEFGH')
})
