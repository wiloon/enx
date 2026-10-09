import { render, screen } from '@testing-library/react'
import CatglishLogo from '../CatglishLogo'
import Login from '../Login'

jest.mock('@clerk/chrome-extension', () => ({
  useUser: () => ({ isLoaded: true, isSignedIn: false }),
}))

describe('CatglishLogo', () => {
  it('fills its rect with its own gradient, so two logos on a page never collide', () => {
    render(
      <>
        <CatglishLogo />
        <CatglishLogo />
      </>
    )

    const ids = screen.getAllByTestId('catglish-logo').map(svg => {
      const gradientId = svg.querySelector('linearGradient')!.id
      expect(svg.querySelector('rect')!.getAttribute('fill')).toBe(
        `url(#${gradientId})`
      )
      return gradientId
    })
    expect(new Set(ids).size).toBe(2)
  })

  it('is decorative', () => {
    render(<CatglishLogo />)
    expect(screen.getByTestId('catglish-logo')).toHaveAttribute(
      'aria-hidden',
      'true'
    )
  })

  it('is what the signed-out sign-in card shows', () => {
    render(<Login />)
    expect(screen.getByText('Sign in to Catglish')).toBeInTheDocument()
    expect(screen.getByTestId('catglish-logo')).toBeInTheDocument()
  })
})
