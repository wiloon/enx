import {
  FEEDBACK_FAILED_MESSAGE,
  FEEDBACK_MAX_LENGTH,
  clampFeedbackText,
  feedbackFailureMessage,
  feedbackRemaining,
  isFeedbackBlank,
} from '../feedback'

describe('feedback text', () => {
  it('stops at 2000 code points, counting an emoji as one', () => {
    expect(FEEDBACK_MAX_LENGTH).toBe(2000)
    expect(clampFeedbackText('😀'.repeat(2001))).toBe('😀'.repeat(2000))
    expect(clampFeedbackText('abc')).toBe('abc')
  })

  it('counts the characters left in code points', () => {
    expect(feedbackRemaining('')).toBe(2000)
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

describe('feedbackFailureMessage', () => {
  it.each([
    [400, 'invalid feedback: bad url'],
    [429, 'Daily feedback limit reached. Please try again tomorrow.'],
  ])("shows the API's message for %i", (status, error) => {
    expect(feedbackFailureMessage(status, error)).toBe(error)
  })

  it.each([
    ['a server error', 500, 'Something went wrong'],
    ['a network error', undefined, "Can't reach Catglish right now."],
  ])('shows the fallback for %s', (_name, status, error) => {
    expect(feedbackFailureMessage(status, error)).toBe(FEEDBACK_FAILED_MESSAGE)
    expect(FEEDBACK_FAILED_MESSAGE).toBe(
      'Could not send the feedback. Please try again.'
    )
  })
})
