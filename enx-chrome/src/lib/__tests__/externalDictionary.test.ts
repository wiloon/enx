import { externalDictionaryUrl } from '../externalDictionary'

const SEARCH =
  'https://dictionary.cambridge.org/search/direct/?datasetsearch=english-chinese-simplified&q='

describe('externalDictionaryUrl', () => {
  it('searches Cambridge English–Chinese (Simplified) for a single word', () => {
    expect(externalDictionaryUrl('resilient')).toBe(`${SEARCH}resilient`)
  })

  it('encodes spaces and characters that are special in a query string', () => {
    expect(externalDictionaryUrl('give up')).toBe(`${SEARCH}give%20up`)
    expect(externalDictionaryUrl('rock & roll')).toBe(
      `${SEARCH}rock%20%26%20roll`
    )
    expect(externalDictionaryUrl('café?')).toBe(`${SEARCH}caf%C3%A9%3F`)
  })

  it('keeps the word as given and lets the search handle capitals', () => {
    expect(externalDictionaryUrl('Apple')).toBe(`${SEARCH}Apple`)
  })
})
