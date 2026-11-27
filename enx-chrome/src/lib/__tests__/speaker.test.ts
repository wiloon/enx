import { popoverHasSpeaker } from '../speaker'
import type { WordData } from '@/types'

const word = (overrides: Partial<WordData> = {}): WordData => ({
  Key: 'run',
  English: 'run',
  Pronunciation: '',
  Chinese: '',
  WordType: 0,
  ...overrides,
})

it('shows the speaker for a Chinese definition', () => {
  expect(
    popoverHasSpeaker({
      word: word({ Chinese: 'v. 跑' }),
      isTranslating: false,
      error: null,
    })
  ).toBe(true)
})

it('shows the speaker for an English-English definition', () => {
  expect(
    popoverHasSpeaker({
      word: word({
        ExplanationLanguage: 'en',
        Senses: [{ pos: 'v', gloss: 'To move fast.' }],
      }),
      isTranslating: false,
      error: null,
    })
  ).toBe(true)
})

it('shows the speaker on a dictionary miss', () => {
  expect(
    popoverHasSpeaker({
      word: word(),
      isTranslating: false,
      error: null,
    })
  ).toBe(true)
})

it('hides the speaker while loading', () => {
  expect(
    popoverHasSpeaker({
      word: word({ Chinese: 'v. 跑' }),
      isTranslating: true,
      error: null,
    })
  ).toBe(false)
})

it('hides the speaker after a failed lookup', () => {
  expect(
    popoverHasSpeaker({
      word: word({ Chinese: 'v. 跑' }),
      isTranslating: false,
      error: 'unavailable',
    })
  ).toBe(false)
})

it('hides the speaker for a phrase', () => {
  expect(
    popoverHasSpeaker({
      word: word({ English: 'look up', Chinese: '查阅' }),
      isTranslating: false,
      error: null,
    })
  ).toBe(false)
})

it('hides the speaker with no current word', () => {
  expect(
    popoverHasSpeaker({ word: null, isTranslating: false, error: null })
  ).toBe(false)
})
