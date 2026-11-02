import {
  createPaintWindow,
  isBlockDisplay,
  partitionBlocks,
} from '@/lib/paintWindow'
import { WordProcessor } from '@/lib/wordProcessor'
import { WordData } from '@/types'

// ADR-069 Decision 2: the article is split into blocks once, from the
// root-level collectTextNodes walk; each text node goes to its nearest block.

const partition = (root: Element) =>
  partitionBlocks(WordProcessor.collectTextNodes(root), root, element =>
    isBlockDisplay(getComputedStyle(element).display)
  )

// Each block's text, keyed by the block's id (or tag name).
const assignments = (root: Element): Record<string, string[]> => {
  const out: Record<string, string[]> = {}
  for (const [block, nodes] of partition(root)) {
    out[block.id || block.tagName.toLowerCase()] = nodes.map(n => n.data.trim())
  }
  return out
}

beforeEach(() => {
  document.body.innerHTML = ''
})

const article = (html: string): Element => {
  document.body.innerHTML = `<article id="root">${html}</article>`
  return document.getElementById('root')!
}

describe('partitionBlocks', () => {
  it('gives text in <pre> and in a block inside <a> no block, and indexes nested block text once', () => {
    const root = article(`
      <div id="outer">Outer text before
        <p id="inner">Inner paragraph <b>bold words</b></p>
        outer text after
      </div>
      <pre>preformatted words</pre>
      <a href="#"><div id="linked">linked block words</div></a>
    `)

    expect(assignments(root)).toEqual({
      outer: ['Outer text before', 'outer text after'],
      inner: ['Inner paragraph', 'bold words'],
    })
  })

  it('treats a display: block custom element or span as its own block', () => {
    const root = article(`
      <div id="wrap">wrapper words
        <enx-note id="note" style="display: block">custom element words</enx-note>
        <span id="span" style="display: block">block span words</span>
        <span>inline span words</span>
      </div>
    `)

    expect(assignments(root)).toEqual({
      wrap: ['wrapper words', 'inline span words'],
      note: ['custom element words'],
      span: ['block span words'],
    })
  })

  it('gives display: contents text to the nearest qualifying ancestor', () => {
    const root = article(`
      <div id="wrap"><section style="display: contents">contents words</section></div>
    `)

    expect(assignments(root)).toEqual({ wrap: ['contents words'] })
  })

  it.each([
    ['hidden display: none', 'display: none'],
    ['inline-block', 'display: inline-block'],
    ['table-row', 'display: table-row'],
    ['table-cell', 'display: table-cell'],
  ])('makes a %s element its own block', (_name, style) => {
    const root = article(
      `<div id="wrap">wrapper words <span id="own" style="${style}">own words</span></div>`
    )

    expect(assignments(root)).toEqual({
      wrap: ['wrapper words'],
      own: ['own words'],
    })
  })

  it('gives text with no block below the root to the root', () => {
    const root = article('root words <span>inline words</span>')

    expect(assignments(root)).toEqual({ root: ['root words', 'inline words'] })
  })
})

describe('painting real blocks', () => {
  afterEach(() => CSS.highlights.clear())

  it('underlines with Ranges and leaves the article DOM untouched', () => {
    const root = article(
      '<p id="p"><span id="s">the endgame is <b id="b">clearly</b> here</span></p>'
    )
    const p = document.getElementById('p')
    const b = document.getElementById('b')
    const htmlBefore = document.body.innerHTML
    const blocks = partition(root)
    const state = (LoadCount: number): WordData => ({
      Key: 'x',
      English: 'x',
      Pronunciation: '',
      Chinese: '',
      LoadCount,
      Known: false,
      WordType: 0,
    })
    const states: Record<string, WordData> = {
      endgame: state(10),
      clearly: state(1),
    }
    const paintWindow = createPaintWindow<Element, Text, Range>({
      textNodes: block => blocks.get(block) ?? [],
      createRange: (node, start, end) => {
        const range = document.createRange()
        range.setStart(node, start)
        range.setEnd(node, end)
        return range
      },
      registry: CSS.highlights,
      newRangeSet: () => new Highlight(),
      wordState: key => states[key],
    })

    blocks.forEach((_nodes, block) => paintWindow.enter(block))

    const text = (name: string) =>
      [...(CSS.highlights.get(name) as unknown as Set<Range>)].map(r =>
        r.toString()
      )
    expect(text('enx-hl-3')).toEqual(['endgame'])
    expect(text('enx-hl-1')).toEqual(['clearly'])
    expect(document.getElementById('p')).toBe(p)
    expect(document.getElementById('b')).toBe(b)
    expect(document.body.innerHTML).toBe(htmlBefore)
  })
})
