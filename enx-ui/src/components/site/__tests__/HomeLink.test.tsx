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
})
