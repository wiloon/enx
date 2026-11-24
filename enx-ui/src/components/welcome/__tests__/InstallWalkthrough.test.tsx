import { act, fireEvent, render, screen } from '@testing-library/react'
import InstallWalkthrough from '../InstallWalkthrough'

const slideImage = () => screen.getByRole('img')
const slideButton = (n: number) =>
  screen.getByRole('button', { name: `Show slide ${n}` })

function setReducedMotion(reduce: boolean) {
  window.matchMedia = jest.fn().mockImplementation((query: string) => ({
    matches: reduce && query === '(prefers-reduced-motion: reduce)',
    media: query,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  }))
}

beforeEach(() => {
  jest.useFakeTimers()
  setReducedMotion(false)
})

afterEach(() => {
  jest.useRealTimers()
})

const advance = (ms: number) =>
  act(() => {
    jest.advanceTimersByTime(ms)
  })

it('starts on the store listing, pointing at Add to Chrome', () => {
  render(<InstallWalkthrough />)
  expect(slideImage()).toHaveAttribute(
    'src',
    '/onboarding/install-store-listing.svg'
  )
  expect(slideImage()).toHaveAccessibleName(/Add to Chrome/)
  expect(
    screen.getByText(/click the blue Add to Chrome button/)
  ).toBeInTheDocument()
  expect(slideButton(1)).toHaveAttribute('aria-current', 'true')
  expect(slideButton(2)).not.toHaveAttribute('aria-current')
})

it('walks Chrome’s install order, then what the extension does, every 5 seconds', () => {
  render(<InstallWalkthrough />)
  advance(5000)
  expect(slideImage()).toHaveAccessibleName(/Continue to install/)
  advance(5000)
  expect(slideImage()).toHaveAccessibleName(/Add extension/)
  advance(5000)
  expect(slideImage()).toHaveAttribute('src', '/onboarding/word-lookup.svg')
  expect(screen.getByText(/Click any word while you read/)).toBeInTheDocument()
  expect(slideButton(4)).toHaveAttribute('aria-current', 'true')
})

it('wraps from the last slide back to the first', () => {
  render(<InstallWalkthrough />)
  advance(4 * 5000)
  expect(slideImage()).toHaveAttribute(
    'src',
    '/onboarding/install-store-listing.svg'
  )
})

it('shows a chosen slide and stops advancing after a click', () => {
  render(<InstallWalkthrough />)
  fireEvent.click(slideButton(3))
  expect(slideImage()).toHaveAccessibleName(/Add extension/)
  expect(slideButton(3)).toHaveAttribute('aria-current', 'true')
  advance(20000)
  expect(slideImage()).toHaveAccessibleName(/Add extension/)
})

it('pauses while the pointer is over it', () => {
  render(<InstallWalkthrough />)
  const carousel = screen.getByRole('region', { name: 'How to install' })
  fireEvent.mouseEnter(carousel)
  advance(20000)
  expect(slideButton(1)).toHaveAttribute('aria-current', 'true')
  fireEvent.mouseLeave(carousel)
  advance(5000)
  expect(slideButton(2)).toHaveAttribute('aria-current', 'true')
})

it('pauses while focus is inside it', () => {
  render(<InstallWalkthrough />)
  fireEvent.focus(slideButton(1))
  advance(20000)
  expect(slideButton(1)).toHaveAttribute('aria-current', 'true')
  fireEvent.blur(slideButton(1))
  advance(5000)
  expect(slideButton(2)).toHaveAttribute('aria-current', 'true')
})

it('does not advance on its own under reduced motion', () => {
  setReducedMotion(true)
  render(<InstallWalkthrough />)
  advance(20000)
  expect(slideButton(1)).toHaveAttribute('aria-current', 'true')
})

it('groups the slide buttons without a list', () => {
  render(<InstallWalkthrough />)
  const group = screen.getByRole('group', { name: 'Slides' })
  expect(group.querySelectorAll('button')).toHaveLength(4)
  expect(screen.queryAllByRole('listitem')).toHaveLength(0)
})
