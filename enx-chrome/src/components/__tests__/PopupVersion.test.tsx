import { act, fireEvent, render, screen } from '@testing-library/react'
import PopupVersion from '../PopupVersion'

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
