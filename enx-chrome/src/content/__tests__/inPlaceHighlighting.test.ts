import { WordProcessor } from '@/lib/wordProcessor'
import { WordData } from '../../types'

// ADR-010 Decision 4: on X the highlight must be wrapped directly into the
// live text nodes, leaving every element node (which React owns and holds
// references to) exactly where it was. These tests lock that property in.

const wd = (word: string, loadCount: number): WordData => ({
  Key: word,
  English: word,
  Chinese: 'x',
  Pronunciation: '',
  LoadCount: loadCount,
  AlreadyAcquainted: 0,
  WordType: 0,
})

describe('in-place highlighting (applyHighlightsToNodes)', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('wraps matched words without recreating any element nodes', () => {
    // Mimics X's span-heavy tweetText markup.
    document.body.innerHTML = `
      <div data-testid="tweetText">
        <span id="s1">The endgame is </span><span id="s2">clearly here</span>
      </div>
    `
    const root = document.querySelector('[data-testid="tweetText"]')!
    const s1 = document.getElementById('s1')
    const s2 = document.getElementById('s2')

    const textNodes = WordProcessor.collectTextNodes(root)
    WordProcessor.applyHighlightsToNodes(textNodes, {
      endgame: wd('endgame', 20),
      clearly: wd('clearly', 10),
    })

    // Same element objects, still in the same place.
    expect(document.getElementById('s1')).toBe(s1)
    expect(document.getElementById('s2')).toBe(s2)
    expect(root.querySelectorAll('span#s1, span#s2')).toHaveLength(2)

    // Words got wrapped, nested under their original span.
    const marks = root.querySelectorAll('u.enx-word')
    expect(Array.from(marks).map(m => m.textContent).sort()).toEqual([
      'clearly',
      'endgame',
    ])
    expect(s1!.querySelector('u.enx-word')!.textContent).toBe('endgame')
    expect(s2!.querySelector('u.enx-word')!.textContent).toBe('clearly')

    // Full visible text is unchanged.
    expect(root.textContent!.replace(/\s+/g, ' ').trim()).toBe(
      'The endgame is clearly here'
    )
  })

  it('wraps known / acquainted words with no underline, not a white one', () => {
    document.body.innerHTML =
      '<div data-testid="tweetText">the endgame is here</div>'
    const root = document.querySelector('[data-testid="tweetText"]')!
    WordProcessor.applyHighlightsToNodes(WordProcessor.collectTextNodes(root), {
      the: wd('the', 0), // common word, never looked up -> not highlighted
      endgame: wd('endgame', 20), // worth reviewing
    })

    const the = root.querySelector('u.enx-the') as HTMLElement
    const endgame = root.querySelector('u.enx-endgame') as HTMLElement

    // both clickable...
    expect(the).not.toBeNull()
    expect(endgame).not.toBeNull()
    // ...but only the review-worthy one is underlined
    expect(the.getAttribute('style')).toContain('text-decoration: none')
    expect(the.getAttribute('style')).not.toContain('underline')
    expect(endgame.getAttribute('style')).toMatch(/text-decoration: hsl\([^)]+\) underline/)
  })

  it('leaves text nodes inside <a> untouched', () => {
    document.body.innerHTML = `
      <div data-testid="tweetText">real words here <a href="/x">hashtag words</a></div>
    `
    const root = document.querySelector('[data-testid="tweetText"]')!
    const textNodes = WordProcessor.collectTextNodes(root)
    WordProcessor.applyHighlightsToNodes(textNodes, { words: wd('words', 5) })

    const marks = root.querySelectorAll('u.enx-word')
    expect(marks).toHaveLength(1)
    expect(marks[0].closest('a')).toBeNull()
    expect(root.querySelector('a')!.textContent).toBe('hashtag words')
  })

  it('collectTextNodes joins across nodes so line-break-adjacent words stay separate', () => {
    document.body.innerHTML = `
      <div data-testid="tweetText"><span>THE REAL ENDGAME</span><br><span>Most people miss it</span></div>
    `
    const root = document.querySelector('[data-testid="tweetText"]')!
    const joined = WordProcessor.collectTextNodes(root)
      .map(n => n.textContent || '')
      .join(' ')
    const words = WordProcessor.extractWords(joined)
    expect(words).toContain('endgame')
    expect(words).toContain('most')
    expect(words).not.toContain('endgamemost')
  })
})
