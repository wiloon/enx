import { fireEvent, render, screen } from '@testing-library/react'
import WordResultCard from '../WordResultCard'
import { WordData } from '@/types'
import { playPronunciation } from '@/lib/pronunciation'

jest.mock('@/lib/pronunciation', () => ({ playPronunciation: jest.fn() }))

const data: WordData = {
  Id: 'w1',
  Key: 'run',
  English: 'run',
  Pronunciation: 'rʌn',
  Chinese: 'v. 跑',
  LoadCount: 3,
  Known: false,
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

it('plays the word when the speaker button is clicked', () => {
  render(<WordResultCard data={data} />)
  fireEvent.click(screen.getByRole('button', { name: 'Play pronunciation' }))
  expect(playPronunciation).toHaveBeenCalledWith('run')
})

it('shows the IPA between slashes even when ECDICT brackets it', () => {
  render(<WordResultCard data={{ ...data, Pronunciation: '[rʌn]' }} />)
  expect(screen.getByText('/rʌn/')).toBeInTheDocument()
})

it('keeps the word id as a small footnote, not a labelled field', () => {
  render(<WordResultCard data={data} />)
  expect(screen.queryByText('Word ID')).not.toBeInTheDocument()
  expect(screen.getByText('ID w1')).toBeInTheDocument()
})

it('shows the lookup source it is given in the footer, beside the id', () => {
  render(<WordResultCard data={data} source="ecdict" />)
  const source = screen.getByTitle('Lookup source')
  expect(source).toHaveTextContent(/^ecdict$/)
  expect(source).toHaveClass('text-muted-foreground')
  expect(source.parentElement).toContainElement(screen.getByText('ID w1'))
})

it('shows no lookup source when none is given', () => {
  render(<WordResultCard data={{ ...data, Source: 'local' }} />)
  expect(screen.queryByTitle('Lookup source')).not.toBeInTheDocument()
})

it('says how many times the word was looked up', () => {
  render(<WordResultCard data={data} />)
  expect(screen.getByTitle('Looked up 3 times')).toBeInTheDocument()
})

it('has no Known badge: a counted lookup always leaves the word in review', () => {
  render(<WordResultCard data={data} />)
  expect(screen.queryByText('Learning')).not.toBeInTheDocument()
  expect(screen.queryByText('Mastered')).not.toBeInTheDocument()
})
