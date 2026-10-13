import { act, render, screen } from '@testing-library/react'
import LoadingSkeleton, { SKELETON_DELAY_MS } from '../LoadingSkeleton'

describe('LoadingSkeleton', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('announces the label at once and reveals the bars after the delay', () => {
    render(<LoadingSkeleton label="Loading translation" testId="loading" />)

    expect(screen.getByRole('status')).toHaveTextContent('Loading translation')
    const bars = screen.getByTestId('loading-skeleton-bars')
    // Space is held from the start, so the card doesn't grow when they show.
    expect(bars.children).toHaveLength(2)
    expect(bars).toHaveClass('invisible')

    act(() => jest.advanceTimersByTime(SKELETON_DELAY_MS - 1))
    expect(bars).toHaveClass('invisible')

    act(() => jest.advanceTimersByTime(1))
    expect(bars).not.toHaveClass('invisible')
  })

  it('pulses and never spins', () => {
    render(<LoadingSkeleton label="Translating..." lines={['w-full']} />)

    const bars = screen.getByTestId('loading-skeleton-bars')
    expect(bars).toHaveClass('animate-pulse')
    expect(bars.children).toHaveLength(1)
    expect(document.querySelector('.animate-spin')).toBeNull()
  })

  it('shows the bars at once with no delay', () => {
    render(<LoadingSkeleton label="Translating..." delayMs={0} />)

    expect(screen.getByTestId('loading-skeleton-bars')).not.toHaveClass(
      'invisible'
    )
  })

  it('drops its timer when unmounted before the delay', () => {
    const { unmount } = render(<LoadingSkeleton label="Translating..." />)
    unmount()
    expect(jest.getTimerCount()).toBe(0)
  })
})
