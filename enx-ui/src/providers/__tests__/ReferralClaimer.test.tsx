import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ReferralClaimer from '../ReferralClaimer'
import { apiService } from '@/services/api'
import {
  REFERRAL_STORAGE_KEY,
  REFERRAL_STORED_EVENT,
  readReferralCode,
  storeReferralCode,
} from '@/lib/referral'
import type { ApiResponse, ReferralClaimData } from '@/types'

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
  const ui = () => (
    <QueryClientProvider client={client}>
      <ReferralClaimer />
    </QueryClientProvider>
  )
  const { rerender, unmount } = render(ui())
  // Re-renders with whatever mockUseAuth now returns.
  const rerenderAuth = () => rerender(ui())
  return { invalidate, rerenderAuth, unmount }
}

// claimReferral answers one call at a time, when the test says so.
function deferredClaims() {
  const answers: Array<(resp: ApiResponse<ReferralClaimData>) => void> = []
  api.claimReferral.mockImplementation(
    () =>
      new Promise<ApiResponse<ReferralClaimData>>((resolve) => {
        answers.push(resolve)
      })
  )
  return {
    answer: async (n: number, resp: ApiResponse<ReferralClaimData>) => {
      await act(async () => {
        answers[n](resp)
      })
    },
  }
}

function openInvite(code: string) {
  act(() => {
    storeReferralCode(window.localStorage, code)
    window.dispatchEvent(new Event(REFERRAL_STORED_EVENT))
  })
}

function signIn(signedIn: boolean, rerenderAuth: () => void) {
  mockUseAuth.mockReturnValue({ isAuthenticated: signedIn, isLoading: false })
  rerenderAuth()
}

const BONUS_B = { success: true, data: { bonus: 50, trialExpiresAt: null } }
const BONUS_A = { success: true, data: { bonus: 100, trialExpiresAt: null } }
const REFUSED = { success: false, error: 'No such invite code.', status: 409 }
const SERVER_ERROR = {
  success: false,
  error: 'Something went wrong.',
  status: 500,
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

describe('a trigger that arrives while a claim is in flight', () => {
  beforeEach(() => {
    jest.spyOn(console, 'info').mockImplementation(() => {})
  })

  it('claims the newer invite once the refused claim settles', async () => {
    storeReferralCode(window.localStorage, 'AAAAAAAA')
    const { answer } = deferredClaims()
    const { invalidate } = renderClaimer()
    await waitFor(() => expect(api.claimReferral).toHaveBeenCalledTimes(1))

    openInvite('BBBBBBBB')
    expect(api.claimReferral).toHaveBeenCalledTimes(1)

    await answer(0, REFUSED)
    expect(api.claimReferral).toHaveBeenCalledTimes(2)
    await answer(1, BONUS_B)

    expect(api.claimReferral.mock.calls).toEqual([['AAAAAAAA'], ['BBBBBBBB']])
    expect(
      screen.getByText('+50 bonus credits from your invite')
    ).toBeInTheDocument()
    expect(window.localStorage.getItem(REFERRAL_STORAGE_KEY)).toBeNull()
    expect(invalidate).toHaveBeenCalledTimes(1)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['billing-me'] })
  })

  it('keeps the first bonus when the follow-up claim is refused', async () => {
    storeReferralCode(window.localStorage, 'AAAAAAAA')
    const { answer } = deferredClaims()
    const { invalidate } = renderClaimer()
    await waitFor(() => expect(api.claimReferral).toHaveBeenCalledTimes(1))

    openInvite('BBBBBBBB')
    await answer(0, BONUS_A)
    await answer(1, REFUSED)
    await act(async () => {})

    expect(api.claimReferral.mock.calls).toEqual([['AAAAAAAA'], ['BBBBBBBB']])
    expect(
      screen.getByText('+100 bonus credits from your invite')
    ).toBeInTheDocument()
    expect(window.localStorage.getItem(REFERRAL_STORAGE_KEY)).toBeNull()
    expect(invalidate).toHaveBeenCalledTimes(1)
  })

  it('retries after the claim settles when the user signed out and back in meanwhile', async () => {
    storeReferralCode(window.localStorage, 'AAAAAAAA')
    const { answer } = deferredClaims()
    const { rerenderAuth } = renderClaimer()
    await waitFor(() => expect(api.claimReferral).toHaveBeenCalledTimes(1))

    signIn(false, rerenderAuth)
    signIn(true, rerenderAuth)
    expect(api.claimReferral).toHaveBeenCalledTimes(1)

    await answer(0, SERVER_ERROR)
    expect(api.claimReferral.mock.calls).toEqual([['AAAAAAAA'], ['AAAAAAAA']])
    await answer(1, BONUS_A)

    expect(window.localStorage.getItem(REFERRAL_STORAGE_KEY)).toBeNull()
    expect(
      screen.getByText('+100 bonus credits from your invite')
    ).toBeInTheDocument()
  })

  it('makes no follow-up claim while the user stays signed out, and claims on the next sign-in', async () => {
    storeReferralCode(window.localStorage, 'AAAAAAAA')
    const { answer } = deferredClaims()
    const { rerenderAuth } = renderClaimer()
    await waitFor(() => expect(api.claimReferral).toHaveBeenCalledTimes(1))

    openInvite('BBBBBBBB')
    signIn(false, rerenderAuth)
    await answer(0, SERVER_ERROR)

    expect(api.claimReferral).toHaveBeenCalledTimes(1)
    expect(readReferralCode(window.localStorage)).toBe('BBBBBBBB')

    signIn(true, rerenderAuth)
    await waitFor(() => expect(api.claimReferral).toHaveBeenCalledTimes(2))
    expect(api.claimReferral).toHaveBeenLastCalledWith('BBBBBBBB')
  })

  it('makes no follow-up claim after the claimer unmounts', async () => {
    storeReferralCode(window.localStorage, 'AAAAAAAA')
    const { answer } = deferredClaims()
    const { unmount } = renderClaimer()
    await waitFor(() => expect(api.claimReferral).toHaveBeenCalledTimes(1))

    openInvite('BBBBBBBB')
    unmount()
    await answer(0, REFUSED)

    expect(api.claimReferral).toHaveBeenCalledTimes(1)
    expect(readReferralCode(window.localStorage)).toBe('BBBBBBBB')
  })
})
