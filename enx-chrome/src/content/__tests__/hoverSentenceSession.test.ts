// Hover sentence translation when the Side Panel may not open (ADR-095).

import { createHoverSentenceSession } from '@/content/hoverSentenceSession'
import { mountSentenceTranslateButton } from '@/content/sentenceTranslateButton'

jest.mock('@/content/sentenceTranslateButton', () => ({
  mountSentenceTranslateButton: jest.fn(() => ({
    overlay: document.createElement('div'),
    cleanup: jest.fn(),
  })),
}))
jest.mock('@/config/preferences', () => ({
  getHoverSentenceTranslateEnabled: async () => true,
  getHoverSentenceShadeEnabled: async () => false,
  onHoverSentenceTranslateEnabledChange: () => () => {},
  onHoverSentenceShadeEnabledChange: () => () => {},
}))

beforeAll(() => {
  Range.prototype.getClientRects = () =>
    [
      { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 },
    ] as unknown as DOMRectList
})

afterEach(() => {
  jest.useRealTimers()
})

it('shows Sign in and sends, records and highlights nothing', async () => {
  jest.useFakeTimers()
  document.body.innerHTML = '<article><p>The quick fox jumps.</p></article>'
  const article = document.querySelector('article')!
  const text = article.querySelector('p')!.firstChild!
  const deps = {
    caretFromPoint: () => ({ node: text, offset: 5 }),
    pointInRange: () => true,
    getLookupExclusions: () => [],
    getArticleRoots: () => [article],
    getWordCache: () => ({}),
    recordReadingPosition: jest.fn(),
    setActiveSentenceHighlight: jest.fn(),
    showSelectionHint: jest.fn(),
    sendOpenSentencePanel: jest.fn(),
    mayOpenSidePanel: () => false,
    showSignInInstead: jest.fn(),
    isCurrentArticle: () => true,
    captureAccount: () => () => true,
    mountShadowRoot: jest.fn(),
    now: () => Date.now(),
  }
  const session = createHoverSentenceSession(deps)
  session.start()
  await jest.advanceTimersByTimeAsync(0)

  session.onArticleMouseMove({
    clientX: 5,
    clientY: 5,
    target: text.parentElement,
    buttons: 0,
  } as unknown as MouseEvent)
  await jest.advanceTimersByTimeAsync(500)
  const [{ onTrigger }] = jest.mocked(mountSentenceTranslateButton).mock
    .calls[0]
  onTrigger()
  await jest.advanceTimersByTimeAsync(0)

  expect(deps.showSignInInstead).toHaveBeenCalledTimes(1)
  expect(deps.showSignInInstead.mock.calls[0][0].toString()).toBe(
    'The quick fox jumps.'
  )
  expect(deps.sendOpenSentencePanel).not.toHaveBeenCalled()
  expect(deps.recordReadingPosition).not.toHaveBeenCalled()
  expect(deps.setActiveSentenceHighlight).not.toHaveBeenCalled()
  session.dispose()
})
