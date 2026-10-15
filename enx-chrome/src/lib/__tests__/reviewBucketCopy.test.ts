import { HIGHLIGHT_BUCKET_COLORS, reviewBucket } from '@/lib/wordHighlight'
import { WordData } from '@/types'
// enx-ui's Word List keeps a copy of the review stages so a word's dot
// matches its underline. Comparing it here makes a change to this side alone
// fail in this suite, not only when someone next runs enx-ui's.
import {
  REVIEW_BUCKET_COLORS as wordListColors,
  reviewBucket as wordListBucket,
} from '../../../../enx-ui/src/lib/reviewBucket'

it("keeps enx-ui's Word List stages in step with the underline", () => {
  expect(wordListColors).toEqual(HIGHLIGHT_BUCKET_COLORS)
  for (let count = 0; count <= 30; count++) {
    for (const known of [false, true]) {
      const word = {
        English: 'x',
        LoadCount: count,
        AlreadyAcquainted: known ? 1 : 0,
        WordType: 0,
      } as WordData
      expect(wordListBucket({ queryCount: count, known })).toBe(
        reviewBucket(word)
      )
    }
  }
})
