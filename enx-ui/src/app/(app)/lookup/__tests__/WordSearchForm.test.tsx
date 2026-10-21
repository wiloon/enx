import { fireEvent, render, screen } from '@testing-library/react'
import WordSearchForm from '../WordSearchForm'

it('searches once when Enter is pressed in the box', () => {
  const onSearch = jest.fn((e: React.FormEvent) => e.preventDefault())
  render(<WordSearchForm value="run" onChange={() => {}} onSearch={onSearch} />)
  const input = screen.getByLabelText('Enter English word')

  // jsdom has no implicit submission, so do what a browser does on Enter:
  // the keydown, then a submit unless the keydown was cancelled.
  const notCancelled = fireEvent.keyDown(input, { key: 'Enter' })
  if (notCancelled) fireEvent.submit(input.closest('form')!)

  expect(onSearch).toHaveBeenCalledTimes(1)
})
