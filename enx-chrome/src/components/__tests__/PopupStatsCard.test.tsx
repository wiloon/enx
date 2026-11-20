import { render, screen } from '@testing-library/react'
import PopupStatsCard from '../PopupStatsCard'
import type { PopupSummary } from '@/lib/popupSummary'

jest.mock('@/config/env', () => ({
  config: { frontendBaseUrl: 'https://catglish.example' },
}))

const loaded: PopupSummary = {
  stats: {
    wordsReadThisWeek: 1237,
    vocabTotal: 1237,
    vocabMastered: 42,
  },
  billing: {
    subscriptionBalance: 0,
    topupBalance: 0,
    trialBalance: 10,
    trialExpiresAt: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    subscriptionStatus: 'none',
    lowBalanceThreshold: 20,
  },
}

describe('PopupStatsCard', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-06-15T12:00:00Z'))
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('shows em dashes while loading', () => {
    render(<PopupStatsCard summary={null} />)

    expect(screen.getAllByText('—')).toHaveLength(2)
    expect(
      screen.queryByRole('link', { name: /AI credits|Trial credits/i })
    ).not.toBeInTheDocument()
  })

  it('shows approximate words read and exact vocab total with links', () => {
    render(<PopupStatsCard summary={loaded} />)

    const statsLink = screen.getByRole('link', {
      name: /About 1,200 words read this week/i,
    })
    expect(statsLink).toHaveAttribute('href', 'https://catglish.example/stats')
    expect(statsLink).toHaveAttribute('target', '_blank')
    expect(statsLink).toHaveTextContent('1,200')
    expect(statsLink).toHaveTextContent('words read this week')

    const wordsLink = screen.getByRole('link', { name: /1,237 words saved/i })
    expect(wordsLink).toHaveAttribute('href', 'https://catglish.example/words')
    expect(wordsLink).toHaveAttribute('target', '_blank')
    expect(wordsLink).toHaveTextContent('1,237')
    expect(wordsLink).toHaveTextContent('42 mastered')
  })

  it('shows em dashes when stats failed and hides the notice when billing failed', () => {
    render(
      <PopupStatsCard
        summary={{
          stats: null,
          billing: null,
        }}
      />
    )

    expect(screen.getAllByText('—')).toHaveLength(2)
    expect(
      screen.queryByRole('link', { name: /AI credits|Trial credits/i })
    ).not.toBeInTheDocument()
  })

  it('shows the credit notice when billing says credits are low', () => {
    render(
      <PopupStatsCard
        summary={{
          stats: loaded.stats,
          billing: {
            subscriptionBalance: 0,
            topupBalance: 8,
            trialBalance: 0,
            trialExpiresAt: null,
            subscriptionStatus: 'active',
            lowBalanceThreshold: 20,
          },
        }}
      />
    )

    const notice = screen.getByRole('link', {
      name: 'Only 8 AI credits left · Get more',
    })
    expect(notice).toHaveAttribute(
      'href',
      'https://catglish.example/billing'
    )
    expect(notice).toHaveAttribute('target', '_blank')
  })

  it('hides the notice when the balance is fine', () => {
    render(
      <PopupStatsCard
        summary={{
          stats: loaded.stats,
          billing: {
            subscriptionBalance: 100,
            topupBalance: 0,
            trialBalance: 0,
            trialExpiresAt: null,
            subscriptionStatus: 'active',
            lowBalanceThreshold: 20,
          },
        }}
      />
    )

    expect(
      screen.queryByRole('link', { name: /AI credits|Trial credits/i })
    ).not.toBeInTheDocument()
  })
})
