import { fireEvent, render, screen } from '@testing-library/react'

// config/env reads import.meta.env, which Jest can't parse.
jest.mock('@/config/env', () => ({
  config: {
    frontendBaseUrl: 'https://catglish.example',
  },
}))

const mockAuth = { isLoaded: true, isSignedIn: false }
jest.mock('@clerk/chrome-extension', () => ({
  useAuth: () => mockAuth,
}))

import PopupHeader from '../PopupHeader'

describe('PopupHeader', () => {
  beforeEach(() => {
    mockAuth.isLoaded = true
    mockAuth.isSignedIn = false
  })

  it('links a signed-out user to the main site in a new tab', () => {
    render(<PopupHeader />)

    const link = screen.getByRole('link', { name: /open catglish/i })
    expect(link).toHaveAttribute('href', 'https://catglish.example')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(link).toContainElement(screen.getByTestId('catglish-logo'))
    expect(link).toHaveTextContent('Catglish')
  })

  it('links a signed-in user to the app home', () => {
    mockAuth.isSignedIn = true
    render(<PopupHeader />)

    expect(
      screen.getByRole('link', { name: /open catglish/i })
    ).toHaveAttribute('href', 'https://catglish.example/app')
  })

  it('links to the main site while the session is still loading', () => {
    mockAuth.isLoaded = false
    render(<PopupHeader />)

    expect(
      screen.getByRole('link', { name: /open catglish/i })
    ).toHaveAttribute('href', 'https://catglish.example')
  })

  it('opens the options page from the settings button', () => {
    const openOptionsPage = jest.fn()
    ;(global as unknown as { chrome: unknown }).chrome = {
      runtime: { openOptionsPage },
    }
    render(<PopupHeader />)

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(openOptionsPage).toHaveBeenCalled()
  })
})
