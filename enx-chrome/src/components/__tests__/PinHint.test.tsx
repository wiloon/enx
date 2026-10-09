import { act, fireEvent, render, screen } from '@testing-library/react'
import PinHint from '../PinHint'

describe('PinHint', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  const setup = () => {
    const onClose = jest.fn()
    const onDontShowAgain = jest.fn()
    render(
      <PinHint
        onClose={onClose}
        onDontShowAgain={onDontShowAgain}
        durationMs={8000}
      />
    )
    return { onClose, onDontShowAgain }
  }

  it('asks the user to pin Catglish', () => {
    setup()
    expect(screen.getByTestId('pin-hint')).toHaveTextContent(
      "Pin Catglish to your toolbar to see when it's on."
    )
  })

  it('closes on its own after the duration', () => {
    const { onClose } = setup()
    act(() => jest.advanceTimersByTime(7999))
    expect(onClose).not.toHaveBeenCalled()
    act(() => jest.advanceTimersByTime(1))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes from its close button', () => {
    const { onClose, onDontShowAgain } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onDontShowAgain).not.toHaveBeenCalled()
  })

  it('offers "Don\'t show again"', () => {
    const { onDontShowAgain } = setup()
    fireEvent.click(screen.getByRole('button', { name: "Don't show again" }))
    expect(onDontShowAgain).toHaveBeenCalledTimes(1)
  })
})
