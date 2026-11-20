import { approximateWords } from '@/lib/approximateWords'

describe('approximateWords', () => {
  it('rounds to the nearest hundred below ten thousand', () => {
    expect(approximateWords(1237)).toBe('1,200')
  })

  it('rounds to the nearest thousand above it', () => {
    expect(approximateWords(84_321)).toBe('84,000')
  })

  it('refuses to imply precision for a handful of words', () => {
    expect(approximateWords(37)).toBe('<100')
  })

  it('shows a real zero as zero, not as "<100"', () => {
    expect(approximateWords(0)).toBe('0')
  })
})
