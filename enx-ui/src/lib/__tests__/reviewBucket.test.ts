import path from 'node:path'
import { REVIEW_BUCKET_COLORS, reviewBucket } from '../reviewBucket'

// The extension's copy is the source this one was taken from; comparing the
// two keeps them from drifting apart. It is loaded at run time, not imported:
// the image build (CNB) gets enx-ui/ alone and `next build` type-checks test
// files too, so a static import of ../enx-chrome fails the build.
const { HIGHLIGHT_BUCKET_COLORS, reviewBucket: extensionReviewBucket } =
  jest.requireActual<{
    HIGHLIGHT_BUCKET_COLORS: readonly string[]
    reviewBucket: (word: {
      English: string
      LoadCount: number
      Known: boolean
      WordType: number
    }) => number | null
  }>(path.join(__dirname, '../../../../enx-chrome/src/lib/wordHighlight'))

describe('reviewBucket', () => {
  it('puts a word into the stage its lookup count reaches', () => {
    expect(reviewBucket({ queryCount: 1, known: false })).toBe(1)
    expect(reviewBucket({ queryCount: 2, known: false })).toBe(1)
    expect(reviewBucket({ queryCount: 3, known: false })).toBe(2)
    expect(reviewBucket({ queryCount: 6, known: false })).toBe(3)
    expect(reviewBucket({ queryCount: 11, known: false })).toBe(4)
    expect(reviewBucket({ queryCount: 19, known: false })).toBe(5)
  })

  it('gives no stage to a known word or one never looked up', () => {
    expect(reviewBucket({ queryCount: 6, known: true })).toBeNull()
    expect(reviewBucket({ queryCount: 0, known: false })).toBeNull()
  })

  it('matches the extension underline for every count, known or not', () => {
    for (let count = 0; count <= 30; count++) {
      for (const known of [false, true]) {
        expect(reviewBucket({ queryCount: count, known })).toBe(
          extensionReviewBucket({
            English: 'x',
            LoadCount: count,
            Known: known,
            WordType: 0,
          })
        )
      }
    }
  })

  it('uses the extension underline colours', () => {
    expect(REVIEW_BUCKET_COLORS).toEqual(HIGHLIGHT_BUCKET_COLORS)
  })
})
