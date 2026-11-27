import {
  englishPronunciation,
  selectPopoverSenses,
  type Sense,
} from '../englishSenses'

const s = (pos: string, gloss: string, example?: string): Sense => ({
  pos,
  gloss,
  ...(example ? { example } : {}),
})

it('keeps at most four senses in the server order', () => {
  expect(
    selectPopoverSenses([
      s('n', '1'),
      s('n', '2'),
      s('v', '3'),
      s('v', '4'),
      s('adj', '5'),
    ])
  ).toEqual([s('n', '1'), s('n', '2'), s('v', '3'), s('v', '4')])
})

it('keeps at most two senses per part of speech (light: 2 noun, 2 adjective)', () => {
  expect(
    selectPopoverSenses([
      s('n', 'n1'),
      s('n', 'n2'),
      s('n', 'n3'),
      s('adj', 'a1'),
      s('adj', 'a2'),
      s('adj', 'a3'),
    ])
  ).toEqual([s('n', 'n1'), s('n', 'n2'), s('adj', 'a1'), s('adj', 'a2')])
})

it('skips a third of one pos so a later other pos still fits', () => {
  expect(
    selectPopoverSenses([
      s('n', '1'),
      s('n', '2'),
      s('n', '3'),
      s('v', '4'),
    ])
  ).toEqual([s('n', '1'), s('n', '2'), s('v', '4')])
})

it('prefers US IPA and falls back to UK', () => {
  expect(
    englishPronunciation({
      PronunciationUS: '/rʌn/',
      PronunciationUK: '/ɹʌn/',
    })
  ).toBe('/rʌn/')
  expect(englishPronunciation({ PronunciationUK: '/ɹʌn/' })).toBe('/ɹʌn/')
  expect(englishPronunciation({})).toBe('')
})
