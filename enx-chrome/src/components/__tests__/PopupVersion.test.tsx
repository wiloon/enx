import { act, fireEvent, render, screen } from '@testing-library/react'
import PopupVersion from '../PopupVersion'
import SendFeedback from '../SendFeedback'

const build = {
  version: '0.1.2',
  environment: 'production',
  commit: '1a2b3c4',
  builtAt: '2026-10-13T08:05:00Z',
}
const details = [
  'Catglish v0.1.2 (production)',
  'Commit 1a2b3c4',
  'Built 2026-10-13 08:05 UTC',
].join('\n')

describe('PopupVersion', () => {
  it('keeps its standalone footer spacing when signed out', () => {
    render(<PopupVersion build={build} copy={jest.fn()} />)
    expect(screen.getByRole('contentinfo')).toHaveClass('px-3', 'pb-2')
  })

  it('omits the standalone footer spacing inside the feedback row', () => {
    render(
      <SendFeedback
        footerEnd={<PopupVersion build={build} copy={jest.fn()} inline />}
      />
    )
    const version = screen.getByRole('button', { name: /v0\.1\.2/ })
    expect(version.closest('footer')).toBeNull()
    expect(version.parentElement).toContainElement(
      screen.getByRole('button', { name: 'Send feedback' })
    )
    expect(version).toHaveClass('text-xs', 'text-muted-foreground')
    expect(version).not.toHaveClass('font-medium')
    expect(version.className).not.toMatch(/-mr-/)
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('shows the version, with the full build details on hover', () => {
    render(<PopupVersion build={build} copy={jest.fn()} />)

    const button = screen.getByRole('button', { name: /v0\.1\.2/ })
    expect(button).toHaveAttribute('title', `${details}\nClick to copy`)
  })

  it('copies the build details when clicked and says so for a moment', async () => {
    jest.useFakeTimers()
    const copy = jest.fn().mockResolvedValue(undefined)
    render(<PopupVersion build={build} copy={copy} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /v0\.1\.2/ }))
    })

    expect(copy).toHaveBeenCalledWith(details)
    expect(screen.getByRole('button')).toHaveTextContent('Copied')

    act(() => {
      jest.advanceTimersByTime(2000)
    })
    expect(screen.getByRole('button')).toHaveTextContent('v0.1.2')
  })

  it('keeps showing the version when the clipboard refuses', async () => {
    const copy = jest.fn().mockRejectedValue(new Error('denied'))
    render(<PopupVersion build={build} copy={copy} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /v0\.1\.2/ }))
    })

    expect(screen.getByRole('button')).toHaveTextContent('v0.1.2')
  })
})
