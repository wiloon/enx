// ICU word segmentation shared by the Side Panel's drag-select phrase lookup
// (ADR-017). Pure string logic -- no DOM -- so the caller maps a DOM Selection
// to a character interval within the sentence string and this snaps that
// interval to whole-word boundaries.
//
// WordProcessor keeps its own Intl.Segmenter for the content-script click path
// (it needs a Range, not a string); the two are allowed to coexist (ADR-017
// Revisit) until they demonstrably drift.

const wordSegmenter = new Intl.Segmenter('en', { granularity: 'word' })

interface Seg {
  start: number
  end: number
  isWord: boolean
}

const segmentsOf = (text: string): Seg[] =>
  [...wordSegmenter.segment(text)].map(s => ({
    start: s.index,
    end: s.index + s.segment.length,
    isWord: s.isWordLike ?? false,
  }))

export interface WordBounds {
  text: string
  start: number
  end: number
  wordCount: number
}

// Given a [start, end) character interval in `text`, expand it outward so both
// ends sit on whole-word boundaries, and report how many words the snapped
// interval spans. An interval that touches no word at all returns
// { text: '', start, end, wordCount: 0 }.
export function snapToWordBounds(
  text: string,
  start: number,
  end: number
): WordBounds {
  const segs = segmentsOf(text)
  const words = segs.filter(s => s.isWord)

  // Every word segment the interval overlaps or touches. For a collapsed
  // caret (start === end) "touches" means the caret sits within [wordStart,
  // wordEnd].
  const hit = words.filter(w =>
    start === end ? w.start <= start && start <= w.end : w.start < end && w.end > start
  )

  if (hit.length === 0) {
    return { text: '', start, end, wordCount: 0 }
  }

  const snappedStart = hit[0].start
  const snappedEnd = hit[hit.length - 1].end
  return {
    text: text.slice(snappedStart, snappedEnd),
    start: snappedStart,
    end: snappedEnd,
    wordCount: hit.length,
  }
}
