import { snapToWordBounds } from '@/lib/wordSegment'

describe('snapToWordBounds', () => {
  // "I hunt down emails every morning"
  //  0         1         2         3
  //  0123456789012345678901234567890123
  //  I=0  hunt=[2,6)  down=[7,11)  emails=[12,18)  every=[19,24)  morning=[25,32)
  const text = 'I hunt down emails every morning'

  it('snaps a selection starting and ending mid-word out to whole-word bounds', () => {
    // user dragged "hu|nt do|wn"
    const r = snapToWordBounds(text, 4, 9)
    expect(r).toEqual({ text: 'hunt down', start: 2, end: 11, wordCount: 2 })
  })

  it('resolves a collapsed caret inside a word to that one word', () => {
    // a plain click lands here -- "ema|ils"
    const r = snapToWordBounds(text, 15, 15)
    expect(r).toEqual({ text: 'emails', start: 12, end: 18, wordCount: 1 })
  })

  it('reports no word when a collapsed caret sits in whitespace', () => {
    const r = snapToWordBounds('a  b', 2, 2)
    expect(r).toEqual({ text: '', start: 2, end: 2, wordCount: 0 })
  })

  it('trims a selection that runs into surrounding whitespace back to the words', () => {
    // " hunt down " -> "hunt down"
    const r = snapToWordBounds(text, 1, 12)
    expect(r).toEqual({ text: 'hunt down', start: 2, end: 11, wordCount: 2 })
  })

  it('keeps a contraction as a single word', () => {
    // "I do|n't care" -- caret inside "don't"
    const r = snapToWordBounds("I don't care", 5, 5)
    expect(r).toEqual({ text: "don't", start: 2, end: 7, wordCount: 1 })
  })
})
