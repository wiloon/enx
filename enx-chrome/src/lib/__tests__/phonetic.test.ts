import { formatPhonetic } from '@/lib/phonetic'

describe('formatPhonetic', () => {
  it('wraps a bare phonetic in slashes', () => {
    expect(formatPhonetic('taid')).toBe('/taid/')
  })

  it('strips existing brackets and re-wraps in slashes', () => {
    expect(formatPhonetic('[ləun]')).toBe('/ləun/')
  })

  it('leaves an already slash-wrapped phonetic unchanged (idempotent)', () => {
    expect(formatPhonetic("/rɪˈtaɪəmənt/")).toBe("/rɪˈtaɪəmənt/")
    expect(formatPhonetic(formatPhonetic('mɒ:gidʒ'))).toBe('/mɒ:gidʒ/')
  })

  it('keeps the last (US) pronunciation when two are concatenated', () => {
    expect(formatPhonetic('[dɪˈskrɪmɪnətəri][dɪˈskrɪmɪnətəːri]')).toBe(
      '/dɪˈskrɪmɪnətəːri/'
    )
  })

  it('keeps a leading stress mark', () => {
    expect(formatPhonetic("'mɒ:gidʒ")).toBe("/'mɒ:gidʒ/")
  })

  it('returns an empty string for missing or blank input', () => {
    expect(formatPhonetic(undefined)).toBe('')
    expect(formatPhonetic(null)).toBe('')
    expect(formatPhonetic('')).toBe('')
    expect(formatPhonetic('   ')).toBe('')
    expect(formatPhonetic('[]')).toBe('')
  })
})
