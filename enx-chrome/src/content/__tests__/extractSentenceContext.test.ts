import { WordProcessor } from '@/lib/wordProcessor'

// ADR-011 Decision 5: extractSentenceContext now takes a Range instead of a
// `.enx-word` element. Callers build the Range differently depending on the
// entry point:
//   - click on a highlighted word  -> range.selectNodeContents(theWord)
//   - single-word drag-selection   -> the live selection Range (text nodes)
//   - phrase drag-selection        -> a collapsed copy of the selection start
// The word text is still wrapped here only so the paragraphs read naturally;
// the highlight markup is irrelevant to this function now.
const wrap = (word: string) =>
  `<span class="w" data-word="${word}">${word}</span>`

// Mirrors the click path: a Range whose start sits at the beginning of the
// clicked word's element.
const rangeOverElement = (el: Element): Range => {
  const range = document.createRange()
  range.selectNodeContents(el)
  return range
}

// Mirrors the drag-select path: a collapsed Range inside a text node, N chars in.
const collapsedRangeInText = (textNode: Node, offset: number): Range => {
  const range = document.createRange()
  range.setStart(textNode, offset)
  range.collapse(true)
  return range
}

describe('WordProcessor.extractSentenceContext', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('locates the correct sentence when the range is in different sentences of the same paragraph', () => {
    document.body.innerHTML = `
      <p>Cats are ${wrap('great')} pets. Dogs are ${wrap('loyal')} companions. Birds can ${wrap('sing')} beautifully.</p>
    `
    const words = document.querySelectorAll<HTMLElement>('.w')
    expect(words).toHaveLength(3)

    expect(
      WordProcessor.extractSentenceContext(rangeOverElement(words[0]), 'great')
        ?.sentence
    ).toBe('Cats are great pets.')
    expect(
      WordProcessor.extractSentenceContext(rangeOverElement(words[1]), 'loyal')
        ?.sentence
    ).toBe('Dogs are loyal companions.')
    expect(
      WordProcessor.extractSentenceContext(rangeOverElement(words[2]), 'sing')
        ?.sentence
    ).toBe('Birds can sing beautifully.')
  })

  it('warns of a sentence without its word, but logs neither the word nor the sentence (#897)', () => {
    document.body.innerHTML = `<p>Cats are ${wrap('great')} pets. Dogs are loyal companions.</p>`
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})

    WordProcessor.extractSentenceContext(
      rangeOverElement(document.querySelector('.w')!),
      'zebra'
    )

    expect(warn).toHaveBeenCalledTimes(1)
    const logged = JSON.stringify(warn.mock.calls)
    expect(logged).not.toContain('zebra')
    expect(logged).not.toContain('Cats')
    warn.mockRestore()
  })

  it('resolves the clicked occurrence of a word repeated twice in the same paragraph, not the first one', () => {
    document.body.innerHTML = `
      <p>The ${wrap('bank')} is by the river. I went to the ${wrap('bank')} to deposit money.</p>
    `
    const words = document.querySelectorAll<HTMLElement>('.w')
    expect(words).toHaveLength(2)

    expect(
      WordProcessor.extractSentenceContext(rangeOverElement(words[0]), 'bank')
        ?.sentence
    ).toBe('The bank is by the river.')
    expect(
      WordProcessor.extractSentenceContext(rangeOverElement(words[1]), 'bank')
        ?.sentence
    ).toBe('I went to the bank to deposit money.')
  })

  it('resolves the sentence containing a multi-word phrase selection (ADR-008 path)', () => {
    document.body.innerHTML = `
      <p>Cats are great pets. You need to find the right contacts and draft outreach quickly. Birds can sing.</p>
    `
    const textNode = document.querySelector('p')!.firstChild as Node
    const full = textNode.textContent || ''
    // The phrase path collapses the selection to its start; here the phrase
    // "find the right contacts" starts mid-sentence.
    const phraseStart = full.indexOf('find the right contacts')

    const result = WordProcessor.extractSentenceContext(
      collapsedRangeInText(textNode, phraseStart),
      'find the right contacts'
    )
    expect(result?.sentence).toBe(
      'You need to find the right contacts and draft outreach quickly.'
    )
  })

  it('works with a collapsed range inside a raw text node (the drag-select path)', () => {
    document.body.innerHTML = `
      <p>The bank is by the river. I went to the bank to deposit money.</p>
    `
    const textNode = document.querySelector('p')!.firstChild as Node
    const full = textNode.textContent || ''
    // Put the range start on the second "bank".
    const secondBank = full.indexOf('bank', full.indexOf('bank') + 1)

    const result = WordProcessor.extractSentenceContext(
      collapsedRangeInText(textNode, secondBank),
      'bank'
    )
    expect(result?.sentence).toBe('I went to the bank to deposit money.')
  })

  it('returns the whole container text when it only contains one sentence', () => {
    document.body.innerHTML = `
      <p>This is the only ${wrap('sentence')} in this paragraph and it is long enough.</p>
    `
    const el = document.querySelector<HTMLElement>('.w')!

    expect(
      WordProcessor.extractSentenceContext(rangeOverElement(el), 'sentence')
        ?.sentence
    ).toBe('This is the only sentence in this paragraph and it is long enough.')
  })

  it('does not mis-split sentences on abbreviations like "Dr."', () => {
    document.body.innerHTML = `
      <p>Dr. Smith works at the hospital. He is a ${wrap('great')} doctor.</p>
    `
    const el = document.querySelector<HTMLElement>('.w')!

    expect(
      WordProcessor.extractSentenceContext(rangeOverElement(el), 'great')
        ?.sentence
    ).toBe('He is a great doctor.')
  })

  it('falls back to a bounded window around the range when the container text exceeds the length cap', () => {
    const filler =
      'This is a long filler sentence used only to pad out the paragraph. '
    const before = filler.repeat(120)
    const after = filler.repeat(120)
    document.body.innerHTML = `<div>${before}The ${wrap('target')} word sits here. ${after}</div>`

    const el = document.querySelector<HTMLElement>('.w')!
    const container = document.querySelector('div')!
    expect(container.textContent!.length).toBeGreaterThan(
      WordProcessor.MAX_SEGMENT_LENGTH
    )

    const result = WordProcessor.extractSentenceContext(
      rangeOverElement(el),
      'target'
    )

    expect(result).not.toBeNull()
    expect(result!.sentence).toContain('target')
    expect(result!.sentence.length).toBeLessThan(
      WordProcessor.SEGMENT_WINDOW_RADIUS * 2 + 200
    )
  })

  it('does not mis-split on "?" inside an inline <code> span, and does not bleed into the next sentence', () => {
    document.body.innerHTML = `
      <p>The parser removes the <code>&lt;?start&gt;</code> and <code>&lt;?end&gt;</code> markers along with any ${wrap(
        'intermediate'
      )} nodes between them. Developers may also include processing instructions.</p>
    `
    const el = document.querySelector<HTMLElement>('.w')!

    const result = WordProcessor.extractSentenceContext(
      rangeOverElement(el),
      'intermediate'
    )

    expect(result?.sentence).toBe(
      'The parser removes the <?start> and <?end> markers along with any intermediate nodes between them.'
    )
    expect(result?.sentence).not.toContain('Developers')
  })

  describe('headings', () => {
    it('returns the whole heading when it sits in no block container', () => {
      document.body.innerHTML = `<article><h2>${wrap('Understanding')} Software Development</h2></article>`
      const el = document.querySelector<HTMLElement>('.w')!

      expect(
        WordProcessor.extractSentenceContext(
          rangeOverElement(el),
          'Understanding'
        )?.sentence
      ).toBe('Understanding Software Development')
    })

    // A minified or framework-rendered page has no whitespace between the
    // heading and the paragraph, so the wrapper's text glues them together
    // and sentence segmentation can't tell where the heading ends.
    it('keeps the heading apart from the next paragraph when markup has no whitespace between them', () => {
      document.body.innerHTML = `<div><h2>Understanding Software ${wrap('Development')}</h2><p>Software development is hard. It takes time.</p></div>`
      const el = document.querySelector<HTMLElement>('.w')!

      expect(
        WordProcessor.extractSentenceContext(
          rangeOverElement(el),
          'Development'
        )?.sentence
      ).toBe('Understanding Software Development')
    })

    it('returns a heading shorter than the container length threshold', () => {
      document.body.innerHTML = `<div><h3>${wrap('Conclusion')}</h3><p>Some long enough paragraph text follows here.</p></div>`
      const el = document.querySelector<HTMLElement>('.w')!

      expect(
        WordProcessor.extractSentenceContext(rangeOverElement(el), 'Conclusion')
          ?.sentence
      ).toBe('Conclusion')
    })

    it('returns the whole heading even when it holds sentence punctuation', () => {
      document.body.innerHTML = `<h1>What is ${wrap('DDD')}? A short primer</h1>`
      const el = document.querySelector<HTMLElement>('.w')!

      const ctx = WordProcessor.extractSentenceContext(
        rangeOverElement(el),
        'DDD'
      )
      expect(ctx?.sentence).toBe('What is DDD? A short primer')
      expect(ctx?.range?.toString()).toBe('What is DDD? A short primer')
    })

    it('leaves a paragraph next to a heading split as before', () => {
      document.body.innerHTML = `<div><h2>Understanding Software Development</h2><p>Software development is ${wrap('hard')}. It takes time.</p></div>`
      const el = document.querySelector<HTMLElement>('.w')!

      expect(
        WordProcessor.extractSentenceContext(rangeOverElement(el), 'hard')
          ?.sentence
      ).toBe('Software development is hard.')
    })
  })

  describe('hard line breaks in the page source', () => {
    const LS = String.fromCharCode(0x2028)
    const PS = String.fromCharCode(0x2029)
    const SEP = /[\s\x85]+/g
    const trimSep = (s: string) => s.replace(/^[\s\x85]+|[\s\x85]+$/g, '')

    const LINES = [
      'Thomas had finished his evening',
      'chores. That is, he had locked',
      'the door of the barn upon his',
      'car and had carried to the kitchen',
      'a handful of chips scraped up in the dark from the ground near the chopping block.',
    ]
    const FIRST = 'Thomas had finished his evening chores.'
    const SECOND =
      'That is, he had locked the door of the barn upon his car and had carried to the kitchen a handful of chips scraped up in the dark from the ground near the chopping block.'

    // Built node by node rather than through innerHTML, which would turn CR
    // and CRLF into LF before the text ever reaches the DOM.
    const buildElement = (
      tag: string,
      text: string,
      words: string[]
    ): HTMLElement => {
      const el = document.createElement(tag)
      const pattern = new RegExp(`\\b(${words.join('|')})\\b`)
      for (const part of text.split(pattern)) {
        if (words.includes(part)) {
          const span = document.createElement('span')
          span.className = 'w'
          span.dataset.word = part
          span.textContent = part
          el.appendChild(span)
        } else if (part) {
          el.appendChild(document.createTextNode(part))
        }
      }
      document.body.appendChild(el)
      return el
    }

    const wordEl = (word: string) =>
      document.querySelector<HTMLElement>(`.w[data-word="${word}"]`)!

    const lookup = (word: string) =>
      WordProcessor.extractSentenceContext(rangeOverElement(wordEl(word)), word)

    const originalSpan = (text: string, first: string, last: string) =>
      text.slice(text.indexOf(first), text.indexOf(last) + last.length)

    it('returns the whole sentence across LF line breaks', () => {
      buildElement('p', LINES.join('\n'), ['barn', 'chores'])

      expect(lookup('barn')?.sentence).toBe(SECOND)
      expect(lookup('chores')?.sentence).toBe(FIRST)
    })

    it.each([
      ['CR', '\r'],
      ['NEL', '\x85'],
      ['LINE SEPARATOR', LS],
      ['PARAGRAPH SEPARATOR', PS],
      ['CRLF', '\r\n'],
    ])('returns each sentence on a single line across %s', (_name, sep) => {
      buildElement('p', LINES.join(sep), ['barn', 'chores'])

      for (const [word, expected] of [
        ['barn', SECOND],
        ['chores', FIRST],
      ]) {
        const sentence = lookup(word)?.sentence ?? ''
        expect(sentence).toBe(expected)
        expect(/[\n\r\x85]/.test(sentence)).toBe(false)
        expect(sentence.includes(LS)).toBe(false)
        expect(sentence.includes(PS)).toBe(false)
      }
    })

    it('collapses indentation and doubled separators between words to one space', () => {
      const text = [
        LINES[0],
        '\n    ',
        LINES[1],
        '\n\n',
        LINES[2],
        '\r\n\t\t',
        LINES[3],
        ` ${LS}${PS} `,
        LINES[4],
      ].join('')
      buildElement('p', text, ['barn', 'chores'])

      for (const [word, expected] of [
        ['barn', SECOND],
        ['chores', FIRST],
      ]) {
        const sentence = lookup(word)?.sentence ?? ''
        expect(sentence).toBe(expected)
        expect(sentence).not.toContain('  ')
      }
    })

    it.each([
      ['LF', '\n'],
      ['CR', '\r'],
      ['NEL', '\x85'],
      ['LINE SEPARATOR', LS],
      ['PARAGRAPH SEPARATOR', PS],
      ['CRLF', '\r\n'],
    ])(
      'spans the whole sentence in the original DOM text across %s',
      (_name, sep) => {
        const text = LINES.join(sep)
        buildElement('p', text, ['barn', 'chores'])

        const second = lookup('barn')!
        expect(second.range?.toString()).toBe(
          originalSpan(text, 'That is', 'block.')
        )
        expect(second.range?.toString().replace(SEP, ' ')).toBe(second.sentence)

        const first = lookup('chores')!
        expect(first.range?.toString()).toBe(
          originalSpan(text, 'Thomas', 'chores.')
        )
        expect(first.range?.toString().replace(SEP, ' ')).toBe(first.sentence)
      }
    )

    it.each([
      ['First', 'First sentence.'],
      ['Second', 'Second sentence.'],
    ])('does not paint a NEL at a sentence boundary (%s)', (word, expected) => {
      buildElement('p', '\x85First sentence.\x85Second sentence.\x85', [
        'First',
        'Second',
      ])

      const ctx = lookup(word)!
      expect(ctx.sentence).toBe(expected)
      expect(ctx.range?.toString()).toBe(expected)
    })

    it('does not paint a NEL at either end of a heading', () => {
      buildElement('h2', '\x85Title words\x85', ['Title'])

      const ctx = lookup('Title')!
      expect(ctx.sentence).toBe('Title words')
      expect(ctx.range?.toString()).toBe('Title words')
    })

    it('returns a hard-wrapped heading on one line, its range over the original text', () => {
      buildElement('h2', ' Understanding\nSoftware   Development\n', [
        'Understanding',
      ])

      const ctx = lookup('Understanding')!
      expect(ctx.sentence).toBe('Understanding Software Development')
      expect(ctx.range?.toString()).toBe(
        'Understanding\nSoftware   Development'
      )
    })

    describe('without sentence segmentation', () => {
      const originalSegmenter = Intl.Segmenter

      beforeEach(() => {
        jest.spyOn(console, 'warn').mockImplementation(() => {})
      })

      afterEach(() => {
        Object.defineProperty(Intl, 'Segmenter', {
          value: originalSegmenter,
          writable: true,
          configurable: true,
        })
        jest.restoreAllMocks()
      })

      const breakSegmenter = () =>
        jest.spyOn(Intl, 'Segmenter').mockImplementation(() => {
          throw new Error('segmenter broken')
        })

      const removeSegmenter = () =>
        Object.defineProperty(Intl, 'Segmenter', {
          value: undefined,
          writable: true,
          configurable: true,
        })

      it.each([
        ['throws', breakSegmenter],
        ['is unavailable', removeSegmenter],
      ])(
        'returns the whole normalized container when Intl.Segmenter %s',
        (_name, disable) => {
          const text = `\n  ${LINES.join('\n')}\x85\n`
          buildElement('p', text, ['barn'])
          disable()

          const ctx = lookup('barn')!
          expect(ctx.sentence).toBe(`${FIRST} ${SECOND}`)
          expect(ctx.range?.toString()).toBe(trimSep(text))
        }
      )

      it('returns the normalized window around the click when Intl.Segmenter throws on an over-cap container', () => {
        const fillerLines = Array.from(
          { length: 120 },
          (_, i) => `filler line number ${i} pads the paragraph out`
        )
        const text = [
          ...fillerLines,
          'the target word sits here',
          ...fillerLines,
        ].join('\n')
        buildElement('p', text, ['target'])
        expect(text.length).toBeGreaterThan(WordProcessor.MAX_SEGMENT_LENGTH)
        breakSegmenter()

        const offset = text.indexOf('target')
        const radius = WordProcessor.SEGMENT_WINDOW_RADIUS
        const slice = text.slice(offset - radius, offset + radius)

        const ctx = lookup('target')!
        expect(ctx.sentence).toBe(slice.replace(SEP, ' ').trim())
        expect(ctx.range?.toString()).toBe(trimSep(slice))
      })
    })
  })

  it('takes the nearest block for a sentence of 20 characters or less (Standard Ebooks byline)', () => {
    document.body.innerHTML = `
      <main><section id="titlepage">
        <h1>Short Fiction</h1>
        <p>By <b>Joseph Conrad</b>.</p>
      </section></main>`
    const text = document.querySelector('b')!.firstChild!
    const range = document.createRange()
    range.setStart(text, 'Joseph '.length)
    range.setEnd(text, 'Joseph Conrad'.length)

    const ctx = WordProcessor.extractSentenceContext(range, 'Conrad')!

    expect(ctx.sentence).toBe('By Joseph Conrad.')
    expect(ctx.range?.toString()).toBe('By Joseph Conrad.')
  })

  it('returns null when no ancestor container qualifies as a sentence container', () => {
    document.body.innerHTML = wrap('orphan')
    const el = document.querySelector<HTMLElement>('.w')!

    expect(
      WordProcessor.extractSentenceContext(rangeOverElement(el), 'orphan')
    ).toBeNull()
  })
})
