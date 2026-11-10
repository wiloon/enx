import {
  clampFeedbackText,
  feedbackRemaining,
  isFeedbackBlank,
} from '../feedback'

// The same rules as enx-ui's feedback.ts and enx-api's feedback.textRecord.
describe('feedback text', () => {
  it('stops at 2000 code points, counting an emoji as one', () => {
    expect(clampFeedbackText('😀'.repeat(2001))).toBe('😀'.repeat(2000))
    expect(clampFeedbackText('abc')).toBe('abc')
    expect(feedbackRemaining('😀😀')).toBe(1998)
  })

  it.each([
    ['', true],
    [' \n\t\u3000', true],
    [' hi ', false],
  ])('treats %j as blank: %s', (text, blank) => {
    expect(isFeedbackBlank(text)).toBe(blank)
  })
})
