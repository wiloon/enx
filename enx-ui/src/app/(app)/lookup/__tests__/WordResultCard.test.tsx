import { fireEvent, render, screen } from '@testing-library/react'
import WordResultCard from '../WordResultCard'
import { WordData } from '@/types'

const data: WordData = {
  Id: 'w1',
  Key: 'run',
  English: 'run',
  Pronunciation: 'rʌn',
  Chinese: 'v. 跑',
  LoadCount: 3,
  AlreadyAcquainted: 0,
  WordType: 0,
}

it('hides Clear when no onClear is given (non-admins)', () => {
  render(<WordResultCard data={data} />)
  expect(
    screen.queryByRole('button', { name: 'Clear' })
  ).not.toBeInTheDocument()
})

it('shows Clear for admins and calls onClear', () => {
  const onClear = jest.fn()
  render(<WordResultCard data={data} onClear={onClear} />)
  fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
  expect(onClear).toHaveBeenCalledTimes(1)
})
