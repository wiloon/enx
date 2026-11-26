import { keepsLineBreak, preservesNewlines } from '@/lib/lineBreaks'

// Whether the break at the first (or `nth`) `\n`, `\r` or `\r\n` is kept.
const keeps = (text: string, nth = 0): boolean => {
  const breaks = [...text.matchAll(/\r\n|\r|\n/g)]
  return keepsLineBreak(text, breaks[nth].index)
}

describe('keepsLineBreak (#1137)', () => {
  it.each(['.', '!', '?'])('keeps a break after "%s"', end => {
    expect(keeps(`Done${end} \t\nnext line`)).toBe(true)
  })

  it.each(['"', "'", ')', ']', '}', '”', '’', '»', '›', '.”)'])(
    'scans back over the closer %s',
    closer => {
      expect(keeps(`He said, “Hello.${closer}\nnext line.`)).toBe(true)
    }
  )

  it('folds a break inside a hard-wrapped sentence', () => {
    expect(keeps('The quick brown fox\njumps over')).toBe(false)
    expect(keeps('a “quoted”\nword')).toBe(false)
  })

  it.each(['- item', '* item', '• item', '  - item', '12.\tItem', '3) item'])(
    'keeps a break before the list item %j',
    line => {
      expect(keeps(`some words\n${line}`)).toBe(true)
    }
  )

  it.each(['-5 degrees', '3.14 is pi', '*emphasis*'])(
    'folds a break before %j, which has no marker',
    line => {
      expect(keeps(`some words\n${line}`)).toBe(false)
    }
  )

  it('keeps both breaks around a blank line', () => {
    const text = 'Heading\n \t\nFirst paragraph'

    expect(keeps(text, 0)).toBe(true)
    expect(keeps(text, 1)).toBe(true)
  })

  it('decides a \\r\\n pair as one break', () => {
    expect(keeps('Done.\r\nnext')).toBe(true)
    expect(keeps('words\r\n- item')).toBe(true)
    // The pair's own `\n` is not a blank line after the `\r`.
    expect(keeps('wrapped\r\nline')).toBe(false)
  })

  it('does not scan across an adjacent break', () => {
    // The period and the marker are each beyond a neighbouring break.
    const text = 'End.\nwrapped\nline\n- item'

    expect(keeps(text, 1)).toBe(false)
  })
})

describe('preservesNewlines (#1137)', () => {
  it.each(['preserve', 'preserve-breaks', 'break-spaces'])(
    'is true for white-space-collapse: %s',
    whiteSpaceCollapse => {
      expect(preservesNewlines({ whiteSpaceCollapse })).toBe(true)
    }
  )

  it('trusts white-space-collapse over white-space', () => {
    expect(
      preservesNewlines({
        whiteSpaceCollapse: 'collapse',
        whiteSpace: 'pre-wrap',
      })
    ).toBe(false)
  })

  it.each([
    'pre',
    'pre-wrap',
    'pre-line',
    'break-spaces',
    'preserve nowrap',
    'preserve-breaks',
  ])('is true for white-space: %s', whiteSpace => {
    expect(preservesNewlines({ whiteSpace })).toBe(true)
  })

  it.each(['normal', 'nowrap', 'collapse', ''])(
    'is false for white-space: "%s"',
    whiteSpace => {
      expect(preservesNewlines({ whiteSpace })).toBe(false)
    }
  )
})
