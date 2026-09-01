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
    const filler = 'This is a long filler sentence used only to pad out the paragraph. '
    const before = filler.repeat(120)
    const after = filler.repeat(120)
    document.body.innerHTML = `<div>${before}The ${wrap('target')} word sits here. ${after}</div>`

    const el = document.querySelector<HTMLElement>('.w')!
    const container = document.querySelector('div')!
    expect(container.textContent!.length).toBeGreaterThan(WordProcessor.MAX_SEGMENT_LENGTH)

    const result = WordProcessor.extractSentenceContext(rangeOverElement(el), 'target')

    expect(result).not.toBeNull()
    expect(result!.sentence).toContain('target')
    expect(result!.sentence.length).toBeLessThan(
      WordProcessor.SEGMENT_WINDOW_RADIUS * 2 + 200
    )
  })

  it('returns null when no ancestor container qualifies as a sentence container', () => {
    document.body.innerHTML = wrap('orphan')
    const el = document.querySelector<HTMLElement>('.w')!

    expect(
      WordProcessor.extractSentenceContext(rangeOverElement(el), 'orphan')
    ).toBeNull()
  })
})
