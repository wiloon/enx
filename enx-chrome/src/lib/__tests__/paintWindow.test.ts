import { createPaintWindow, type PaintWindow } from '@/lib/paintWindow'
import { WordData } from '@/types'

// ADR-069 Decisions 2-4: the paint window on fakes. A block is a list of
// fake text nodes, the registry a Map of Sets, a Range the text it covers.

interface FakeNode {
  data: string
}
interface FakeRange {
  node: FakeNode
  start: number
  end: number
}
type Block = FakeNode[]

const wd = (overrides: Partial<WordData> = {}): WordData => ({
  Key: 'x',
  English: 'x',
  Pronunciation: '',
  Chinese: '来',
  LoadCount: 1,
  Known: false,
  WordType: 0,
  ...overrides,
})

let registry: Map<string, Set<FakeRange>>
let words: Record<string, WordData>
let pw: PaintWindow<Block>

const block = (...texts: string[]): Block => texts.map(data => ({ data }))

// Every underlined word, by highlight name, in insertion order.
const painted = (): Record<string, string[]> => {
  const out: Record<string, string[]> = {}
  for (const [name, ranges] of registry) {
    out[name] = [...ranges].map(r => r.node.data.slice(r.start, r.end))
  }
  return out
}

const change = (word: string, data: WordData | undefined) => {
  if (data) words[word] = data
  else delete words[word]
  pw.wordsChanged([word])
}

beforeEach(() => {
  registry = new Map()
  words = {}
  pw = createPaintWindow<Block, FakeNode, FakeRange>({
    textNodes: b => b,
    createRange: (node, start, end) => ({ node, start, end }),
    registry,
    newRangeSet: () => new Set(),
    wordState: key => words[key],
  })
})

describe('a block entering and leaving the window', () => {
  it('underlines its review list words on entering and removes them on leaving', () => {
    words = { fox: wd(), dog: wd({ LoadCount: 9 }) }
    const b = block('the fox and the dog', 'a fox again')

    pw.enter(b)
    expect(painted()).toEqual({
      'enx-hl-1': ['fox', 'fox'],
      'enx-hl-3': ['dog'],
    })

    pw.leave(b)
    expect(painted()).toEqual({})
  })

  it('paints a word outside the window in its new state when its block enters', () => {
    words = { fox: wd() }
    const b = block('the fox and the dog')

    change('fox', wd({ LoadCount: 9 }))
    change('dog', wd())
    pw.enter(b)

    expect(painted()).toEqual({ 'enx-hl-3': ['fox'], 'enx-hl-1': ['dog'] })
  })

  it('adds no duplicate ranges when an already-present block enters again', () => {
    words = { fox: wd() }
    const b = block('the fox')

    pw.enter(b)
    pw.enter(b)

    expect(painted()).toEqual({ 'enx-hl-1': ['fox'] })
  })

  it('leaving one of two blocks with the same word keeps the other block’s ranges and bucket', () => {
    words = { fox: wd() }
    const first = block('the fox')
    const second = block('another fox', 'and a dog')
    pw.enter(first)
    pw.enter(second)

    pw.leave(first)
    expect(painted()).toEqual({ 'enx-hl-1': ['fox'] })

    change('fox', wd({ LoadCount: 9 }))
    expect(painted()).toEqual({ 'enx-hl-3': ['fox'] })
    expect(registry.get('enx-hl-3')!.values().next().value!.node).toBe(
      second[0]
    )
  })
})

describe('a word state change', () => {
  it('marking a word known removes its underlines and leaves other words untouched', () => {
    words = { fox: wd(), dog: wd() }
    pw.enter(block('the fox and the dog', 'one more fox'))
    const dogRange = [...registry.get('enx-hl-1')!].find(r => r.start === 16)

    change('fox', wd({ Known: true }))

    expect(painted()).toEqual({ 'enx-hl-1': ['dog'] })
    expect([...registry.get('enx-hl-1')!][0]).toBe(dogRange)
  })

  it('a first lookup underlines the word at every position in the window', () => {
    pw.enter(block('the fox and'))
    pw.enter(block('a fox', 'two fox'))
    expect(painted()).toEqual({})

    change('fox', wd())

    expect(painted()).toEqual({ 'enx-hl-1': ['fox', 'fox', 'fox'] })
  })

  it('a lookup that keeps the review bucket makes no highlight change', () => {
    words = { fox: wd({ LoadCount: 1 }) }
    pw.enter(block('the fox'))
    const before = [...registry.get('enx-hl-1')!]
    const set = jest.spyOn(registry, 'set')
    const del = jest.spyOn(registry, 'delete')

    change('fox', wd({ LoadCount: 2 }))

    expect([...registry.get('enx-hl-1')!]).toEqual(before)
    expect(set).not.toHaveBeenCalled()
    expect(del).not.toHaveBeenCalled()
  })

  it('a lookup that crosses a bucket boundary moves only that word’s ranges', () => {
    words = { fox: wd({ LoadCount: 2 }), dog: wd() }
    pw.enter(block('the fox and the dog and a fox'))

    change('fox', wd({ LoadCount: 3 }))

    expect(painted()).toEqual({
      'enx-hl-1': ['dog'],
      'enx-hl-2': ['fox', 'fox'],
    })
  })

  it('a known word looked up again gets its underlines back (P-7)', () => {
    words = { fox: wd({ Known: true }) }
    pw.enter(block('the fox'))
    expect(painted()).toEqual({})

    change('fox', wd({ LoadCount: 4 }))

    expect(painted()).toEqual({ 'enx-hl-2': ['fox'] })
  })

  it('removes a bucket left empty from the registry', () => {
    words = { fox: wd() }
    pw.enter(block('the fox'))

    change('fox', wd({ LoadCount: 9 }))

    expect([...registry.keys()]).toEqual(['enx-hl-3'])
  })

  it('moves Fox, fox’s and FOX’S together under one word key', () => {
    words = { fox: wd() }
    pw.enter(block("Fox and the fox’s den and FOX'S tail"))
    expect(painted()).toEqual({ 'enx-hl-1': ['Fox', 'fox’s', "FOX'S"] })

    change('fox', wd({ LoadCount: 9 }))

    expect(painted()).toEqual({ 'enx-hl-3': ['Fox', 'fox’s', "FOX'S"] })
  })

  it('skips a position whose text changed, without an exception or a wrong underline', () => {
    const b = block('the fox and the fox')
    pw.enter(b)
    b[0].data = 'the cat and the fox'

    expect(() => change('fox', wd())).not.toThrow()

    const [range] = [...registry.get('enx-hl-1')!]
    expect(painted()).toEqual({ 'enx-hl-1': ['fox'] })
    expect(range.start).toBe(16)
  })
})

describe('which words a block underlines', () => {
  it('matches contractions and hyphenated compounds as whole words', () => {
    words = { 'well-known': wd(), "isn't": wd() }
    pw.enter(block("it's a well-known problem, isn't it"))

    expect(painted()).toEqual({ 'enx-hl-1': ['well-known', "isn't"] })
  })

  it('matches a curly-apostrophe contraction against the straight list word', () => {
    words = { "don't": wd() }
    pw.enter(block('we don’t know'))

    expect(painted()).toEqual({ 'enx-hl-1': ['don’t'] })
  })

  it('matches only the letter part of word-then-number compounds', () => {
    words = { covid: wd(), catch: wd() }
    pw.enter(block('the COVID-19 and Catch-22 situation'))

    expect(painted()).toEqual({ 'enx-hl-1': ['COVID', 'Catch'] })
  })

  it('underlines no word that was never looked up or is absent', () => {
    words = { endgame: wd({ LoadCount: 0 }) }
    pw.enter(block('the endgame is clearly here'))

    expect(painted()).toEqual({})
  })
})

describe('clearing the window', () => {
  it('leaves no highlights and empty indexes, and paints nothing afterwards', () => {
    words = { fox: wd(), dog: wd({ LoadCount: 9 }) }
    const b = block('the fox and the dog')
    pw.enter(b)

    pw.clear()
    expect(painted()).toEqual({})
    expect(pw.indexSize()).toEqual({ blocks: 0, words: 0 })

    pw.enter(b)
    change('fox', wd({ LoadCount: 4 }))
    expect(painted()).toEqual({})
    expect(pw.indexSize()).toEqual({ blocks: 0, words: 0 })
  })

  it('leaves highlights it does not own in place', () => {
    const foreign = new Set<FakeRange>()
    registry.set('site-search', foreign)
    words = { fox: wd() }
    pw.enter(block('the fox'))

    pw.clear()

    expect([...registry.keys()]).toEqual(['site-search'])
  })
})
