import { WordData } from '@/types'
import {
  HIGHLIGHT_NAME_PREFIX,
  reviewBucket,
  tokenizeWords,
  wordKey,
} from '@/lib/wordHighlight'

// The paint window (ADR-069 Decisions 2-4): underlines exist only for the
// blocks near the viewport, and a word state change touches only that word.
// The caller reports blocks entering and leaving the window (an
// IntersectionObserver in content.tsx) and words whose state changed. Text
// nodes, Range construction and the highlight registry come in as ports, so
// this runs on fakes.

// A block is any element whose box is not inline: display none,
// inline-block and table boxes included. A hidden block is observed but
// does not intersect until it is shown. An empty value is display's initial
// value, inline.
export const isBlockDisplay = (display: string): boolean =>
  display !== '' && display !== 'inline' && display !== 'contents'

// Assigns each text node of one root-level collectTextNodes walk to its
// nearest block ancestor, or to `root` when none sits below it. Walking from
// each block instead would let isInExcludedSubtree, which stops at the root
// it is given, admit text inside <pre> or <a>, and count nested text twice.
export const partitionBlocks = (
  textNodes: readonly Text[],
  root: Element,
  isBlock: (element: Element) => boolean
): Map<Element, Text[]> => {
  const blocks = new Map<Element, Text[]>()
  const blockOf = new Map<Element, Element>()
  for (const node of textNodes) {
    const parent = node.parentElement
    if (!parent) continue
    let block = blockOf.get(parent)
    if (!block) {
      let current: Element | null = parent
      while (current && current !== root && !isBlock(current)) {
        current = current.parentElement
      }
      block = current ?? root
      blockOf.set(parent, block)
    }
    const nodes = blocks.get(block)
    if (nodes) nodes.push(node)
    else blocks.set(block, [node])
  }
  return blocks
}

export interface RangeSet<R> {
  add(range: R): unknown
  delete(range: R): boolean
  readonly size: number
}

export interface RangeRegistry<R> {
  get(name: string): RangeSet<R> | undefined
  set(name: string, ranges: RangeSet<R>): unknown
  delete(name: string): boolean
}

export interface PaintWindowPorts<B, N extends { readonly data: string }, R> {
  // The text nodes the block partition assigned to `block`.
  textNodes: (block: B) => readonly N[]
  createRange: (node: N, start: number, end: number) => R
  registry: RangeRegistry<R>
  newRangeSet: () => RangeSet<R>
  // The word's current state, keyed by wordKey.
  wordState: (key: string) => WordData | undefined
}

export interface PaintWindow<B> {
  enter(block: B): void
  leave(block: B): void
  // Call after the word states have been updated; reads no storage.
  wordsChanged(words: readonly string[]): void
  // Terminal: the instance paints nothing afterwards.
  clear(): void
  indexSize(): { blocks: number; words: number }
}

// Where a word occurs: every word in the window is recorded, underlined or
// not, so a first lookup can underline all its occurrences.
interface Position<N, R> {
  node: N
  start: number
  end: number
  word: string
  key: string
  range: R | null
}

export const createPaintWindow = <B, N extends { readonly data: string }, R>(
  ports: PaintWindowPorts<B, N, R>
): PaintWindow<B> => {
  const blockPositions = new Map<B, Position<N, R>[]>()
  const wordPositions = new Map<string, Set<Position<N, R>>>()
  // The bucket each word is painted in now. wordState already holds the new
  // state when wordsChanged is called, so the old one is remembered here.
  const paintedBucket = new Map<string, number>()
  const owned = new Map<number, RangeSet<R>>()
  let cleared = false

  const highlightName = (bucket: number) => `${HIGHLIGHT_NAME_PREFIX}${bucket}`

  const currentBucket = (key: string): number | null => {
    const state = ports.wordState(key)
    return state ? reviewBucket(state) : null
  }

  const rangeSet = (bucket: number): RangeSet<R> => {
    let set = owned.get(bucket)
    if (!set) {
      set = ports.newRangeSet()
      owned.set(bucket, set)
      ports.registry.set(highlightName(bucket), set)
    }
    return set
  }

  const releaseIfEmpty = (bucket: number) => {
    const set = owned.get(bucket)
    if (!set || set.size > 0) return
    owned.delete(bucket)
    if (ports.registry.get(highlightName(bucket)) === set) {
      ports.registry.delete(highlightName(bucket))
    }
  }

  // A recorded position is only underlined while its text is still the word.
  const paint = (positions: Iterable<Position<N, R>>, bucket: number) => {
    let set: RangeSet<R> | null = null
    for (const position of positions) {
      const { node, start, end, word } = position
      if (node.data.slice(start, end) !== word) continue
      position.range = ports.createRange(node, start, end)
      set ??= rangeSet(bucket)
      set.add(position.range)
    }
  }

  const unpaint = (positions: Iterable<Position<N, R>>, bucket: number) => {
    const set = owned.get(bucket)
    for (const position of positions) {
      if (position.range) set?.delete(position.range)
      position.range = null
    }
    releaseIfEmpty(bucket)
  }

  // Brings every recorded position of `key` to its current bucket.
  const repaintWord = (key: string) => {
    const positions = wordPositions.get(key)
    if (!positions) return
    const painted = paintedBucket.get(key) ?? null
    const bucket = currentBucket(key)
    if (painted === bucket) return
    if (painted !== null) unpaint(positions, painted)
    paintedBucket.delete(key)
    if (bucket === null) return
    paint(positions, bucket)
    paintedBucket.set(key, bucket)
  }

  const enter = (block: B) => {
    if (cleared || blockPositions.has(block)) return
    const added = new Map<string, Position<N, R>[]>()
    const positions: Position<N, R>[] = []
    for (const node of ports.textNodes(block)) {
      for (const { word, start, end } of tokenizeWords(node.data)) {
        const position = {
          node,
          start,
          end,
          word,
          key: wordKey(word),
          range: null,
        }
        positions.push(position)
        const forKey = added.get(position.key)
        if (forKey) forKey.push(position)
        else added.set(position.key, [position])
      }
    }
    blockPositions.set(block, positions)

    for (const [key, keyPositions] of added) {
      let known = wordPositions.get(key)
      if (!known) wordPositions.set(key, (known = new Set()))
      keyPositions.forEach(position => known.add(position))

      const painted = paintedBucket.get(key)
      if (painted !== undefined && painted === currentBucket(key)) {
        paint(keyPositions, painted)
      } else {
        repaintWord(key)
      }
    }
  }

  const leave = (block: B) => {
    const positions = blockPositions.get(block)
    if (!positions) return
    blockPositions.delete(block)

    const touched = new Set<number>()
    for (const position of positions) {
      const bucket = paintedBucket.get(position.key)
      if (position.range && bucket !== undefined) {
        owned.get(bucket)?.delete(position.range)
        touched.add(bucket)
      }
      const known = wordPositions.get(position.key)
      known?.delete(position)
      if (known?.size === 0) {
        wordPositions.delete(position.key)
        paintedBucket.delete(position.key)
      }
    }
    touched.forEach(releaseIfEmpty)
  }

  const wordsChanged = (words: readonly string[]) => {
    if (cleared) return
    for (const word of words) repaintWord(wordKey(word))
  }

  const clear = () => {
    cleared = true
    for (const [bucket, set] of owned) {
      if (ports.registry.get(highlightName(bucket)) === set) {
        ports.registry.delete(highlightName(bucket))
      }
    }
    owned.clear()
    blockPositions.clear()
    wordPositions.clear()
    paintedBucket.clear()
  }

  return {
    enter,
    leave,
    wordsChanged,
    clear,
    indexSize: () => ({
      blocks: blockPositions.size,
      words: wordPositions.size,
    }),
  }
}
