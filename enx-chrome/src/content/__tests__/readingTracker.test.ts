import {
  IDLE_FLUSH_MS,
  noteWordInteraction,
  startArticle,
  stopReading,
} from '@/content/readingTracker'

const ARTICLE_TEXT = Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ')

// Starts tracking an article and clicks a word a quarter of the way in: below
// the flush-on-progress bar, so the progress stays unreported.
const readAQuarter = (send: jest.Mock) => {
  document.body.innerHTML = `<article><p>${ARTICLE_TEXT}</p></article>`
  const paragraph = document.querySelector('p')!
  startArticle([paragraph], 200, send)
  const start = ARTICLE_TEXT.indexOf('word50 ')
  const word = document.createRange()
  word.setStart(paragraph.firstChild!, start)
  word.setEnd(paragraph.firstChild!, start + 6)
  noteWordInteraction(word)
}

describe('readingTracker.stopReading (#561)', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })
  afterEach(() => {
    stopReading()
    jest.useRealTimers()
  })

  it('reports unreported progress when the page is hidden', () => {
    const send = jest.fn()
    readAQuarter(send)
    expect(send).not.toHaveBeenCalled()

    window.dispatchEvent(new Event('pagehide'))

    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0].wordsRead).toBeGreaterThan(40)
  })

  it('after a stop, neither listeners nor the idle timer report anything', () => {
    const send = jest.fn()
    readAQuarter(send)

    stopReading()
    window.dispatchEvent(new Event('pagehide'))
    window.dispatchEvent(new Event('scroll'))
    document.dispatchEvent(new Event('visibilitychange'))
    jest.advanceTimersByTime(IDLE_FLUSH_MS * 2)

    expect(send).not.toHaveBeenCalled()
  })

  it('a click after a stop starts no new reporting', () => {
    const send = jest.fn()
    readAQuarter(send)
    stopReading()

    const range = document.createRange()
    range.selectNodeContents(document.querySelector('p')!)
    noteWordInteraction(range)
    jest.advanceTimersByTime(IDLE_FLUSH_MS * 2)

    expect(send).not.toHaveBeenCalled()
  })
})
