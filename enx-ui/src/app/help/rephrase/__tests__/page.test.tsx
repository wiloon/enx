import { render, screen } from '@testing-library/react'
import RephraseHelpPage from '../page'

it('explains how to rephrase Chinese or rough English and links to the tool', () => {
  render(<RephraseHelpPage />)
  expect(
    screen.getByRole('heading', {
      level: 1,
      name: 'Rephrase into idiomatic English',
    })
  ).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Open Rephrase' })).toHaveAttribute(
    'href',
    '/rephrase'
  )
  expect(
    screen.getByText(/Type what you want to say in Chinese/)
  ).toHaveTextContent('200 characters')
  expect(screen.getByText(/one or two alternatives/)).toBeInTheDocument()
  expect(screen.getByText(/uses AI credits/)).toBeInTheDocument()
})
