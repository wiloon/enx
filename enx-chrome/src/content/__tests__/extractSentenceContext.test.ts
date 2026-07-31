import { WordProcessor } from '@/lib/wordProcessor'

// Mirrors the markup WordProcessor.renderWithHighlights() actually produces:
// each highlighted word is wrapped in <u class="enx-word ...">.
const wrapWord = (word: string) => `<u class="enx-word enx-${word.toLowerCase()}" data-word="${word}">${word}</u>`

describe('WordProcessor.extractSentenceContext', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('locates the correct sentence when clicking words in different sentences of the same paragraph', () => {
    document.body.innerHTML = `
      <p>Cats are ${wrapWord('great')} pets. Dogs are ${wrapWord('loyal')} companions. Birds can ${wrapWord('sing')} beautifully.</p>
    `
    const elements = document.querySelectorAll<HTMLElement>('.enx-word')
    expect(elements).toHaveLength(3)

    const greatResult = WordProcessor.extractSentenceContext(elements[0], 'great')
    expect(greatResult?.sentence).toBe('Cats are great pets.')

    const loyalResult = WordProcessor.extractSentenceContext(elements[1], 'loyal')
    expect(loyalResult?.sentence).toBe('Dogs are loyal companions.')

    const singResult = WordProcessor.extractSentenceContext(elements[2], 'sing')
    expect(singResult?.sentence).toBe('Birds can sing beautifully.')
  })

  it('resolves the clicked occurrence of a word repeated twice in the same paragraph, not the first one', () => {
    document.body.innerHTML = `
      <p>The ${wrapWord('bank')} is by the river. I went to the ${wrapWord('bank')} to deposit money.</p>
    `
    const elements = document.querySelectorAll<HTMLElement>('.enx-word')
    expect(elements).toHaveLength(2)

    const firstOccurrence = WordProcessor.extractSentenceContext(elements[0], 'bank')
    expect(firstOccurrence?.sentence).toBe('The bank is by the river.')

    const secondOccurrence = WordProcessor.extractSentenceContext(elements[1], 'bank')
    expect(secondOccurrence?.sentence).toBe('I went to the bank to deposit money.')
  })

  it('returns the whole container text when it only contains one sentence', () => {
    document.body.innerHTML = `
      <p>This is the only ${wrapWord('sentence')} in this paragraph and it is long enough.</p>
    `
    const element = document.querySelector<HTMLElement>('.enx-word')!

    const result = WordProcessor.extractSentenceContext(element, 'sentence')
    expect(result?.sentence).toBe(
      'This is the only sentence in this paragraph and it is long enough.'
    )
  })

  it('does not mis-split sentences on abbreviations like "Dr."', () => {
    document.body.innerHTML = `
      <p>Dr. Smith works at the hospital. He is a ${wrapWord('great')} doctor.</p>
    `
    const element = document.querySelector<HTMLElement>('.enx-word')!

    const result = WordProcessor.extractSentenceContext(element, 'great')
    expect(result?.sentence).toBe('He is a great doctor.')
    // If "Dr." were mis-treated as a sentence boundary, the resolved sentence
    // would start mid-word or merge unrelated fragments instead of this.
  })

  it('falls back to a bounded window around the word when the container text exceeds the length cap', () => {
    const filler = 'This is a long filler sentence used only to pad out the paragraph. '
    const before = filler.repeat(120) // well past MAX_SEGMENT_LENGTH (5000)
    const after = filler.repeat(120)
    document.body.innerHTML = `<div>${before}The ${wrapWord('target')} word sits here. ${after}</div>`

    const element = document.querySelector<HTMLElement>('.enx-word')!
    const container = document.querySelector('div')!
    expect(container.textContent!.length).toBeGreaterThan(WordProcessor.MAX_SEGMENT_LENGTH)

    const result = WordProcessor.extractSentenceContext(element, 'target')

    expect(result).not.toBeNull()
    expect(result!.sentence).toContain('target')
    // Bounded by the window (2x radius) plus one sentence's worth of slack,
    // not the full multi-thousand-character container.
    expect(result!.sentence.length).toBeLessThan(WordProcessor.SEGMENT_WINDOW_RADIUS * 2 + 200)
  })

  it('returns null when no ancestor container qualifies as a sentence container', () => {
    // No <p>/<li>/<blockquote>/<td>/<div> ancestor at all.
    document.body.innerHTML = wrapWord('orphan')
    const element = document.querySelector<HTMLElement>('.enx-word')!

    const result = WordProcessor.extractSentenceContext(element, 'orphan')
    expect(result).toBeNull()
  })
})
