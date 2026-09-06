import { playPronunciation } from '../pronunciation'

class FakeAudio {
  static instances: FakeAudio[] = []
  url: string
  playResult: Promise<void>
  private errorListeners: Array<() => void> = []

  constructor(url: string) {
    this.url = url
    this.playResult = Promise.resolve()
    FakeAudio.instances.push(this)
  }

  addEventListener(event: string, listener: () => void) {
    if (event === 'error') this.errorListeners.push(listener)
  }

  play() {
    return this.playResult
  }

  emitError() {
    this.errorListeners.forEach(listener => listener())
  }
}

describe('playPronunciation', () => {
  let speakMock: jest.Mock

  beforeEach(() => {
    FakeAudio.instances = []
    // @ts-expect-error jsdom's Audio doesn't implement playback; swap in a fake.
    globalThis.Audio = FakeAudio
    speakMock = jest.fn()
    Object.defineProperty(window, 'speechSynthesis', {
      value: { speak: speakMock },
      configurable: true,
    })
    // jsdom doesn't implement the Web Speech API at all.
    // @ts-expect-error minimal stand-in for the constructor
    globalThis.SpeechSynthesisUtterance = jest.fn(function (
      this: { text: string; lang: string },
      text: string
    ) {
      this.text = text
      this.lang = ''
    })
  })

  it('does nothing for an empty word', () => {
    playPronunciation('')
    expect(FakeAudio.instances).toHaveLength(0)
  })

  it('plays the Youdao audio URL for the word', () => {
    playPronunciation('hello')
    expect(FakeAudio.instances).toHaveLength(1)
    expect(FakeAudio.instances[0].url).toBe(
      'https://dict.youdao.com/dictvoice?audio=hello&type=2'
    )
  })

  it('does not fall back to speech synthesis when playback succeeds', async () => {
    playPronunciation('hello')
    await Promise.resolve()
    expect(speakMock).not.toHaveBeenCalled()
  })

  it('falls back to speech synthesis when playback rejects', async () => {
    const instance = new FakeAudio('unused')
    instance.playResult = Promise.reject(new Error('blocked'))
    // @ts-expect-error swap in the pre-built rejecting instance
    globalThis.Audio = jest.fn(() => instance)

    playPronunciation('hello')
    await Promise.resolve().then(() => Promise.resolve())

    expect(speakMock).toHaveBeenCalledTimes(1)
    const utterance = speakMock.mock.calls[0][0]
    expect(utterance.text).toBe('hello')
    expect(utterance.lang).toBe('en-US')
  })

  it('falls back to speech synthesis when the audio element errors', () => {
    playPronunciation('hello')
    FakeAudio.instances[0].emitError()
    expect(speakMock).toHaveBeenCalledTimes(1)
  })

  it('speaks only once when both play() rejects and the element errors', async () => {
    const instance = new FakeAudio('unused')
    instance.playResult = Promise.reject(new Error('blocked'))
    // @ts-expect-error swap in the pre-built rejecting instance
    globalThis.Audio = jest.fn(() => instance)

    playPronunciation('hello')
    instance.emitError()
    await Promise.resolve().then(() => Promise.resolve())

    expect(speakMock).toHaveBeenCalledTimes(1)
  })
})
