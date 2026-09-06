import { render, screen } from '@testing-library/react'
import ReadingStatsPage from '../page'

it('lays out the daily, weekly, and monthly sections', () => {
  render(<ReadingStatsPage />)

  expect(
    screen.getByRole('heading', { name: 'Reading Stats' })
  ).toBeInTheDocument()
  expect(screen.getByText('Daily')).toBeInTheDocument()
  expect(screen.getByText('Weekly')).toBeInTheDocument()
  expect(screen.getByText('Monthly')).toBeInTheDocument()
})
