import { render, screen } from '@testing-library/react'
import WelcomePage from '../welcome/page'

jest.mock('@/components/welcome/WelcomeGuide', () => ({
  __esModule: true,
  default: (props: {
    fromInstall: boolean
    trialTerms: { status: string; amount?: number; ttlDays?: number }
  }) => (
    <div
      data-testid="welcome-guide"
      data-from-install={String(props.fromInstall)}
      data-trial-status={props.trialTerms.status}
      data-trial-amount={
        props.trialTerms.status === 'terms'
          ? String(props.trialTerms.amount)
          : ''
      }
      data-trial-ttl={
        props.trialTerms.status === 'terms'
          ? String(props.trialTerms.ttlDays)
          : ''
      }
    />
  ),
}))

const mockLoadTrialTerms = jest.fn()
jest.mock('@/lib/trialTerms', () => ({
  loadTrialTerms: (...args: unknown[]) => mockLoadTrialTerms(...args),
}))

beforeEach(() => {
  mockLoadTrialTerms.mockReset()
  mockLoadTrialTerms.mockResolvedValue({
    status: 'terms',
    amount: 100,
    ttlDays: 30,
  })
})

describe('/welcome page', () => {
  it('passes the loader trial terms to WelcomeGuide', async () => {
    const terms = { status: 'terms' as const, amount: 100, ttlDays: 30 }
    mockLoadTrialTerms.mockResolvedValue(terms)

    render(await WelcomePage({ searchParams: Promise.resolve({}) }))

    expect(mockLoadTrialTerms).toHaveBeenCalled()
    const guide = screen.getByTestId('welcome-guide')
    expect(guide).toHaveAttribute('data-from-install', 'false')
    expect(guide).toHaveAttribute('data-trial-status', 'terms')
    expect(guide).toHaveAttribute('data-trial-amount', '100')
    expect(guide).toHaveAttribute('data-trial-ttl', '30')
  })

  it('marks fromInstall when src=install', async () => {
    render(
      await WelcomePage({
        searchParams: Promise.resolve({ src: 'install' }),
      })
    )

    expect(screen.getByTestId('welcome-guide')).toHaveAttribute(
      'data-from-install',
      'true'
    )
  })
})
