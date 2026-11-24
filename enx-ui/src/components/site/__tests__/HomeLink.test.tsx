import { fireEvent, render, screen } from '@testing-library/react'

const mockPathname = jest.fn(() => '/')
jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
}))

import HomeLink from '../HomeLink'

const scrollTo = jest.fn()

beforeEach(() => {
  scrollTo.mockClear()
  window.scrollTo = scrollTo
  mockPathname.mockReturnValue('/')
})

function clickLogo(init?: MouseEventInit) {
  render(<HomeLink className="">Catglish</HomeLink>)
  const link = screen.getByRole('link', { name: 'Catglish' })
  // fireEvent returns false when a handler called preventDefault().
  return fireEvent.click(link, init)
}

describe('HomeLink', () => {
  it('links home', () => {
    render(<HomeLink className="">Catglish</HomeLink>)
    expect(screen.getByRole('link', { name: 'Catglish' })).toHaveAttribute(
      'href',
      '/'
    )
  })

  it('sets data-no-progress on the landing page where onClick cancels navigation', () => {
    render(<HomeLink className="">Catglish</HomeLink>)
    expect(screen.getByRole('link', { name: 'Catglish' })).toHaveAttribute(
      'data-no-progress'
    )
  })

  it('omits data-no-progress off the landing page', () => {
    mockPathname.mockReturnValue('/pricing')
    render(<HomeLink className="">Catglish</HomeLink>)
    expect(screen.getByRole('link', { name: 'Catglish' })).not.toHaveAttribute(
      'data-no-progress'
    )
  })

  it('scrolls to the top in place when already on the landing page', () => {
    window.history.replaceState(null, '', '/#features')
    expect(clickLogo()).toBe(false)
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }))
    expect(window.location.hash).toBe('')
  })

  it('navigates normally from another page', () => {
    mockPathname.mockReturnValue('/pricing')
    clickLogo()
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('leaves modified clicks (open in new tab) alone', () => {
    expect(clickLogo({ metaKey: true })).toBe(true)
    expect(scrollTo).not.toHaveBeenCalled()
  })

  describe('with an onClick handler', () => {
    function clickWith(handler: (e: React.MouseEvent) => void) {
      render(
        <HomeLink className="" onClick={handler}>
          Catglish
        </HomeLink>
      )
      return fireEvent.click(screen.getByRole('link', { name: 'Catglish' }))
    }

    it('lets a handler that calls preventDefault take over the navigation', () => {
      window.history.replaceState(null, '', '/#features')
      const handler = jest.fn((e: React.MouseEvent) => {
        expect(scrollTo).not.toHaveBeenCalled()
        e.preventDefault()
      })

      expect(clickWith(handler)).toBe(false)

      expect(handler).toHaveBeenCalledTimes(1)
      expect(scrollTo).not.toHaveBeenCalled()
      expect(window.location.hash).toBe('#features')
    })

    it('still scrolls to the top when the handler leaves the click alone', () => {
      window.history.replaceState(null, '', '/#features')
      const handler = jest.fn()

      expect(clickWith(handler)).toBe(false)

      expect(handler).toHaveBeenCalledTimes(1)
      expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }))
      expect(window.location.hash).toBe('')
    })
  })
})
