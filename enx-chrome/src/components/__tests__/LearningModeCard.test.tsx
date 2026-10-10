import { fireEvent, render, screen } from '@testing-library/react'
import LearningModeCard, {
  type LearningModeCardStatus,
} from '../LearningModeCard'

const setup = (status: LearningModeCardStatus) => {
  const onEnable = jest.fn()
  const onTurnOff = jest.fn()
  render(
    <LearningModeCard
      status={status}
      onEnable={onEnable}
      onTurnOff={onTurnOff}
    />
  )
  return { onEnable, onTurnOff }
}

describe('LearningModeCard', () => {
  it('offers "Read with Catglish" while off, and enables on click', () => {
    const { onEnable, onTurnOff } = setup('off')

    fireEvent.click(screen.getByRole('button', { name: 'Read with Catglish' }))

    expect(onEnable).toHaveBeenCalledTimes(1)
    expect(onTurnOff).not.toHaveBeenCalled()
    expect(screen.queryByText('Catglish is on')).not.toBeInTheDocument()
  })

  it('disables the enable button while the page is being prepared', () => {
    setup('enabling')

    expect(screen.getByRole('button', { name: 'Enabling…' })).toBeDisabled()
  })

  it('shows an "on" status, not the enable button, once enabled', () => {
    setup('on')

    expect(screen.getByRole('status')).toHaveTextContent('Catglish is on')
    expect(screen.getByRole('status')).toHaveTextContent(
      'Click any word to look it up'
    )
    expect(
      screen.queryByRole('button', { name: 'Read with Catglish' })
    ).not.toBeInTheDocument()
  })

  it('turns off from the "on" status', () => {
    const { onEnable, onTurnOff } = setup('on')

    fireEvent.click(screen.getByRole('button', { name: 'Turn off' }))

    expect(onTurnOff).toHaveBeenCalledTimes(1)
    expect(onEnable).not.toHaveBeenCalled()
  })

  it('disables Turn off while turning off', () => {
    setup('turning-off')

    expect(screen.getByRole('button', { name: 'Turning off…' })).toBeDisabled()
  })

  // jsdom has no layout, so pin the shared fixed-height class instead: without
  // it the card grows on enable and everything below it jumps.
  it.each<LearningModeCardStatus>(['off', 'enabling', 'on', 'turning-off'])(
    'keeps the same fixed height while %s',
    status => {
      setup(status)

      const root =
        status === 'on' || status === 'turning-off'
          ? screen.getByTestId('learning-mode-card')
          : screen.getByTestId('learning-mode-enable')
      expect(root).toHaveClass('h-13')
      expect(root).not.toHaveClass('py-2.5')
    }
  )
})
