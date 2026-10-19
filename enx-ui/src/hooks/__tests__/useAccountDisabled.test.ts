import { act, renderHook } from '@testing-library/react'
import { apiService } from '@/services/api'
import { useAccountDisabled } from '../useAccountDisabled'

it('turns true when enx-api answers account_disabled', async () => {
  ;(global.fetch as jest.Mock) = jest.fn().mockResolvedValue({
    ok: false,
    status: 403,
    statusText: 'Forbidden',
    json: async () => ({
      success: false,
      code: 'account_disabled',
      message: 'This account has been disabled.',
    }),
  })
  const { result } = renderHook(() => useAccountDisabled())
  expect(result.current).toBe(false)

  await act(async () => {
    await apiService.getMe()
  })

  expect(result.current).toBe(true)
})
