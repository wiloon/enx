import { render, screen } from '@testing-library/react'
import PageHeader from '../PageHeader'

it('names the page with its one top-level heading and the description under it', () => {
  render(
    <PageHeader title="Word List" description="Every word you looked up." />
  )

  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  expect(
    screen.getByRole('heading', { level: 1, name: 'Word List' })
  ).toBeInTheDocument()
  expect(screen.getByText('Every word you looked up.')).toBeInTheDocument()
})

it('places actions beside the title', () => {
  render(
    <PageHeader title="Reader" actions={<button type="button">New</button>} />
  )

  expect(screen.getByRole('button', { name: 'New' })).toBeInTheDocument()
})
