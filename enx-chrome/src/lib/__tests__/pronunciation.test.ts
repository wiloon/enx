import { pickEnglishVoice, playPronunciation } from '../pronunciation'

const voice = (name: string, lang: string) =>
  ({ name, lang }) as SpeechSynthesisVoice

describe('pickEnglishVoice', () => {
  it('prefers an en-US voice', () => {
    const us = voice('US', 'en-US')
    expect(pickEnglishVoice([voice('GB', 'en-GB'), us])).toBe(us)
  })

  it('takes any English voice when there is no en-US one', () => {
    const gb = voice('GB', 'en-GB')
    expect(pickEnglishVoice([voice('DE', 'de-DE'), gb])).toBe(gb)
  })

  it('returns undefined when no voice is English', () => {
    expect(
      pickEnglishVoice([voice('DE', 'de-DE'), voice('ZH', 'zh-CN')])
    ).toBeUndefined()
  })
})

describe('playPronunciation', () => {
  let speakMock: jest.Mock
  let cancelMock: jest.Mock
  let voices: SpeechSynthesisVoice[]
  const calls: string[] = []

  beforeEach(() => {
    calls.length = 0
    voices = []
    speakMock = jest.fn(() => calls.push('speak'))
    cancelMock = jest.fn(() => calls.push('cancel'))
    Object.defineProperty(window, 'speechSynthesis', {
      value: {
        speak: speakMock,
        cancel: cancelMock,
        getVoices: () => voices,
      },
      configurable: true,
    })
    // jsdom doesn't implement the Web Speech API at all.
    // @ts-expect-error minimal stand-in for the constructor
    globalThis.SpeechSynthesisUtterance = jest.fn(function (
      this: { text: string; lang: string; voice: SpeechSynthesisVoice | null },
      text: string
    ) {
      this.text = text
      this.lang = ''
      this.voice = null
    })
  })

  it('does nothing for an empty word', () => {
    voices = [voice('US', 'en-US')]
    playPronunciation('')
    expect(speakMock).not.toHaveBeenCalled()
  })

  it('cancels, then speaks the word in en-US with the selected English voice', () => {
    const us = voice('US', 'en-US')
    voices = [voice('GB', 'en-GB'), us]

    playPronunciation('hello')

    expect(calls).toEqual(['cancel', 'speak'])
    const utterance = speakMock.mock.calls[0][0]
    expect(utterance.text).toBe('hello')
    expect(utterance.lang).toBe('en-US')
    expect(utterance.voice).toBe(us)
  })

  it('does not speak when the voice list has no English voice', () => {
    voices = [voice('DE', 'de-DE')]
    playPronunciation('hello')
    expect(speakMock).not.toHaveBeenCalled()
  })

  it('speaks in en-US with no voice assigned while the voice list is empty', () => {
    playPronunciation('hello')

    expect(speakMock).toHaveBeenCalledTimes(1)
    const utterance = speakMock.mock.calls[0][0]
    expect(utterance.text).toBe('hello')
    expect(utterance.lang).toBe('en-US')
    expect(utterance.voice).toBeNull()
  })

  it('selects an English voice once the empty voice list has loaded', () => {
    playPronunciation('hello')
    const us = voice('US', 'en-US')
    voices = [us]

    playPronunciation('world')

    expect(speakMock).toHaveBeenCalledTimes(2)
    const utterance = speakMock.mock.calls[1][0]
    expect(utterance.text).toBe('world')
    expect(utterance.voice).toBe(us)
  })

  it('does not throw when the browser has no speechSynthesis', () => {
    // @ts-expect-error simulate a browser without the Web Speech API
    delete window.speechSynthesis
    expect(() => playPronunciation('hello')).not.toThrow()
  })
})
