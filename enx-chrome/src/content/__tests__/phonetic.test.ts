/**
 * Tests for US phonetic extraction logic.
 *
 * Some words stored before the Youdao API migration have both UK and US
 * phonetics concatenated in the Pronunciation field, e.g.:
 *   "[dɪˈskrɪmɪnətəri][dɪˈskrɪmɪnətə:ri]"
 * The second bracket pair is always the American English pronunciation.
 */

const extractUSPhonetic = (pronunciation: string): string => {
  const matches = pronunciation.match(/\[[^\]]+\]/g)
  if (matches && matches.length >= 2) {
    return matches[matches.length - 1]
  }
  return pronunciation
}

describe('extractUSPhonetic', () => {
  it('returns the last phonetic when two are present', () => {
    const input = '[dɪˈskrɪmɪnətəri][dɪˈskrɪmɪnətə:ri]'
    expect(extractUSPhonetic(input)).toBe('[dɪˈskrɪmɪnətə:ri]')
  })

  it('returns the string unchanged when only one phonetic is present', () => {
    const input = '[dɪˈskrɪmɪnətəri]'
    expect(extractUSPhonetic(input)).toBe('[dɪˈskrɪmɪnətəri]')
  })

  it('returns the string unchanged when there are no brackets', () => {
    const input = 'dɪˈskrɪmɪnətəri'
    expect(extractUSPhonetic(input)).toBe('dɪˈskrɪmɪnətəri')
  })

  it('returns an empty string unchanged', () => {
    expect(extractUSPhonetic('')).toBe('')
  })

  it('handles three phonetics by returning the last one', () => {
    const input = '[a][b][c]'
    expect(extractUSPhonetic(input)).toBe('[c]')
  })
})
