import { render, screen } from '@testing-library/react'
import HowItWorks from '../HowItWorks'

it('names the popup button with a decorative icon chip and no shortcut hint', () => {
  render(<HowItWorks />)
  const chip = screen.getByText('Read with Catglish', { selector: 'span' })
  expect(chip.closest('p')).toHaveTextContent(
    'then press the Read with Catglish button.'
  )
  expect(chip.querySelector('svg')).toHaveClass('lucide-mouse-pointer-click')
  expect(chip.closest('button, a, [role=button], [role=link]')).toBeNull()
  expect(chip.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  expect(screen.queryByText(/Or press/)).not.toBeInTheDocument()
})
