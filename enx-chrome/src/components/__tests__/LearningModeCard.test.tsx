import { fireEvent, render, screen } from '@testing-library/react'
import type { LearningModeShortcut } from '@/lib/learningModeCommand'
import LearningModeCard, {
  type LearningModeCardStatus,
} from '../LearningModeCard'

const setup = (
  status: LearningModeCardStatus,
  shortcut?: LearningModeShortcut
) => {
  const onEnable = jest.fn()
  const onTurnOff = jest.fn()
  render(
    <LearningModeCard
      status={status}
      shortcut={shortcut}
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

  // #230: the key that toggles learning mode with the popup closed, as
  // Chrome reports it -- never a hard-coded "Alt+C".
  describe('shortcut', () => {
    const bound: LearningModeShortcut = { bound: true, key: '⌥C' }
    const unbound: LearningModeShortcut = { bound: false }

    it('shows the bound key inside the enable button', () => {
      setup('off', bound)

      expect(screen.getByTestId('learning-mode-enable')).toHaveTextContent(
        /Read with Catglish\s*⌥C/
      )
      expect(screen.queryByText('Set a shortcut')).not.toBeInTheDocument()
    })

    it('shows the bound key on Turn off too, since it toggles both ways', () => {
      setup('on', bound)

      expect(screen.getByTestId('learning-mode-turn-off')).toHaveTextContent(
        /Turn off\s*⌥C/
      )
      expect(screen.queryByText('Set a shortcut')).not.toBeInTheDocument()
    })

    it.each<LearningModeCardStatus>(['off', 'on'])(
      'offers "Set a shortcut" outside the button when unbound (%s)',
      status => {
        setup(status, unbound)

        const link = screen.getByRole('button', { name: /Set a shortcut/ })
        const control = screen.getByTestId(
          status === 'on' ? 'learning-mode-card' : 'learning-mode-enable'
        )
        expect(control).not.toContainElement(link)
        expect(screen.queryByText('⌥C')).not.toBeInTheDocument()
      }
    )

    it('opens Chrome\'s shortcut settings from "Set a shortcut"', () => {
      const { onEnable } = setup('off', unbound)

      fireEvent.click(screen.getByRole('button', { name: /Set a shortcut/ }))

      expect(chrome.tabs.create).toHaveBeenCalledWith({
        url: 'chrome://extensions/shortcuts',
      })
      expect(onEnable).not.toHaveBeenCalled()
    })

    // Until chrome.commands.getAll() answers, show neither, so the link
    // doesn't flash for a user whose key is bound.
    it('shows neither the key nor the link before the binding is known', () => {
      setup('off')

      expect(screen.getByTestId('learning-mode-enable')).toHaveTextContent(
        /^Read with Catglish$/
      )
      expect(screen.queryByText('Set a shortcut')).not.toBeInTheDocument()
    })
  })
})
