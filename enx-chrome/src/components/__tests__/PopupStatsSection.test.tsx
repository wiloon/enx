import { act, render, screen, waitFor } from '@testing-library/react'
import PopupStatsSection from '../PopupStatsSection'
import type { PopupSummary } from '@/lib/popupSummary'

jest.mock('@/config/env', () => ({
  config: { frontendBaseUrl: 'https://catglish.example' },
}))

describe('PopupStatsSection', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-06-15T12:00:00Z'))
    ;(chrome.runtime.sendMessage as jest.Mock).mockReset()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('shows em dashes while the GET_POPUP_SUMMARY reply is held, then fills in', async () => {
    let resolve!: (value: PopupSummary) => void
    const held = new Promise<PopupSummary>(r => {
      resolve = r
    })
    ;(chrome.runtime.sendMessage as jest.Mock).mockReturnValue(held)

    render(<PopupStatsSection />)

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'GET_POPUP_SUMMARY',
    })
    expect(screen.getAllByText('—')).toHaveLength(2)
    expect(
      screen.queryByTestId('popup-stats-credit-notice')
    ).not.toBeInTheDocument()

    await act(async () => {
      resolve({
        stats: {
          wordsReadThisWeek: 1237,
          vocabTotal: 42,
          vocabMastered: 7,
        },
        billing: {
          subscriptionBalance: 0,
          topupBalance: 8,
          trialBalance: 0,
          trialExpiresAt: null,
          subscriptionStatus: 'active',
          lowBalanceThreshold: 20,
        },
      })
      await held
    })

    await waitFor(() => {
      expect(screen.getByText('1,200')).toBeInTheDocument()
    })
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Only 8 AI credits left · Get more' })
    ).toBeInTheDocument()
  })

  it('shows em dashes when the stats half failed', async () => {
    ;(chrome.runtime.sendMessage as jest.Mock).mockResolvedValue({
      stats: null,
      billing: {
        subscriptionBalance: 100,
        topupBalance: 0,
        trialBalance: 0,
        trialExpiresAt: null,
        subscriptionStatus: 'active',
        lowBalanceThreshold: 20,
      },
    } satisfies PopupSummary)

    render(<PopupStatsSection />)

    await waitFor(() => {
      expect(screen.getAllByText('—')).toHaveLength(2)
    })
    expect(
      screen.queryByTestId('popup-stats-credit-notice')
    ).not.toBeInTheDocument()
  })

  it('hides the notice when the billing half failed', async () => {
    ;(chrome.runtime.sendMessage as jest.Mock).mockResolvedValue({
      stats: {
        wordsReadThisWeek: 500,
        vocabTotal: 10,
        vocabMastered: 2,
      },
      billing: null,
    } satisfies PopupSummary)

    render(<PopupStatsSection />)

    await waitFor(() => {
      expect(screen.getByText('500')).toBeInTheDocument()
    })
    expect(
      screen.queryByTestId('popup-stats-credit-notice')
    ).not.toBeInTheDocument()
  })
})
