// Word cards follow the explanation language they were looked up in
// (ADR-098 Decision 7, ADR-023 Decision 8; #1235).

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'

jest.mock('@/lib/sentry', () => ({ initSentry: jest.fn() }))
jest.mock('@/config/env', () => ({
  config: { frontendBaseUrl: 'http://localhost:3000' },
}))
jest.mock('@/services/api', () => ({ sendMessageToBackground: jest.fn() }))

import { sendMessageToBackground } from '@/services/api'
import { latestPageWordKey, pendingSentenceKey } from '@/lib/sidePanel'
import { panelHistoryKey } from '@/lib/panelHistoryStore'
import { installPanelHistoryChrome } from '@/test/installPanelHistoryChrome'
import SidePanel from '../SidePanel'

const TAB = 7
const SENTENCE = 'Cats are great pets.'

const send = sendMessageToBackground as jest.Mock

type Message = { type: string; word?: string }

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => (resolve = r))
  return { promise, resolve }
}

const zhDefinition = (word: string) => ({
  success: true,
  ecp: {
    English: word,
    Chinese: `中文-${word}`,
    Pronunciation: 'greɪt',
    ExplanationLanguage: 'zh-Hans',
  },
})

const enDefinition = (word: string, gloss = `meaning of ${word}`) => ({
  success: true,
  ecp: {
    English: word,
    Chinese: '',
    Pronunciation: '',
    ExplanationLanguage: 'en',
    Senses: [{ pos: 'adj', gloss }],
  },
})

let assumed: 'zh-Hans' | 'en'
let dictionary: (message: Message) => unknown
let context: (message: Message) => unknown
let panelChrome: ReturnType<typeof installPanelHistoryChrome>

const sentTypes = (type: string) =>
  send.mock.calls.filter(([message]) => message.type === type)

const page = (key: string, value: Record<string, unknown>, eventId: string) =>
  act(async () => {
    panelChrome.fireStorageChange(
      { [key]: { newValue: { createdAt: 1, eventId, ...value } } },
      'session'
    )
  })

const selectWord = (text: string) => {
  const el = screen.getByTestId('sidepanel-sentence')
  const node = el.firstChild as Text
  const start = SENTENCE.indexOf(text)
  const range = document.createRange()
  range.setStart(node, start)
  range.setEnd(node, start + text.length)
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
  fireEvent.mouseUp(el)
}

const openSentence = async () => {
  panelChrome.seedSession({
    [pendingSentenceKey(TAB)]: {
      word: '',
      sentence: SENTENCE,
      createdAt: 1,
      eventId: 'evt-sentence',
    },
  })
  render(<SidePanel />)
  await screen.findByTestId('sidepanel-sentence')
}

const greatCards = () => screen.queryAllByTestId('sidepanel-card-great')

const storedWords = () =>
  (
    panelChrome.sessionBag[panelHistoryKey(TAB)] as {
      entries: { words?: Record<string, unknown>[] }[]
    }
  ).entries[0].words ?? []

beforeEach(() => {
  jest.clearAllMocks()
  window.history.replaceState({}, '', `/sidepanel.html?tabId=${TAB}`)
  CSS.highlights.clear()
  panelChrome = installPanelHistoryChrome({ tabId: TAB })
  ;(chrome.storage.local.get as jest.Mock).mockResolvedValue({})
  ;(chrome.tabs.sendMessage as jest.Mock).mockResolvedValue(undefined)
  assumed = 'zh-Hans'
  dictionary = message =>
    assumed === 'en' ? enDefinition(message.word!) : zhDefinition(message.word!)
  context = () => ({ success: true, chinese: '很棒的' })
  send.mockImplementation(async (message: Message) => {
    switch (message.type) {
      case 'getExplanationLanguage':
        return { success: true, explanationLanguage: assumed }
      case 'translateSentence':
        return { success: true, chinese: '猫是很棒的宠物。' }
      case 'getOneWord':
        return dictionary(message)
      case 'translateWordInContext':
        return context(message)
      default:
        return { success: false }
    }
  })
})

describe('after the explanation language switched', () => {
  it('adds an English card when a word with a Chinese card is clicked again', async () => {
    await openSentence()
    selectWord('great')
    await waitFor(() => expect(greatCards()[0]).toHaveTextContent('中文-great'))

    assumed = 'en'
    selectWord('great')

    await waitFor(() => expect(greatCards()).toHaveLength(2))
    await waitFor(() =>
      expect(greatCards()[0]).toHaveTextContent('meaning of great')
    )
    expect(greatCards()[1]).toHaveTextContent('中文-great')
  })

  it('leaves a top-level card of the other language where it is when a sentence is sent', async () => {
    render(<SidePanel />)
    await screen.findByTestId('sidepanel-empty-state')
    await page(
      latestPageWordKey(TAB),
      { word: 'cats', ecp: zhDefinition('cats').ecp },
      'evt-page'
    )
    await screen.findByTestId('sidepanel-card-cats')

    assumed = 'en'
    await page(
      pendingSentenceKey(TAB),
      { word: '', sentence: SENTENCE },
      'evt-sentence'
    )
    await screen.findByTestId('sidepanel-sentence')

    const card = screen.getByTestId('sidepanel-card-cats')
    expect(
      card.closest('[data-testid^="sidepanel-sentence-entry-"]')
    ).toBeNull()
  })
})

describe('a Clear while the language query is still pending', () => {
  // Holds the next language query open until `answer` is called.
  const holdLanguageQuery = () => {
    const query = deferred<unknown>()
    const respond = send.getMockImplementation()!
    send.mockImplementation((message: Message) =>
      message.type === 'getExplanationLanguage'
        ? query.promise
        : respond(message)
    )
    return () =>
      act(async () =>
        query.resolve({ success: true, explanationLanguage: assumed })
      )
  }

  it('clears the word clicked before it, and Undo brings the word back', async () => {
    await openSentence()
    const answer = holdLanguageQuery()

    selectWord('great')
    fireEvent.click(screen.getByTestId('sidepanel-clear-all'))
    await answer()

    const undo = await screen.findByTestId('sidepanel-undo-clear')
    expect(greatCards()).toHaveLength(0)

    fireEvent.click(undo)
    await waitFor(() => expect(greatCards()).toHaveLength(1))
  })

  it('clears the sentence sent before it, and Undo brings the sentence back', async () => {
    await openSentence()
    const answer = holdLanguageQuery()

    await page(
      pendingSentenceKey(TAB),
      { word: '', sentence: 'Dogs are loyal.' },
      'evt-second'
    )
    fireEvent.click(screen.getByTestId('sidepanel-clear-all'))
    await answer()

    const undo = await screen.findByTestId('sidepanel-undo-clear')
    expect(screen.queryAllByTestId('sidepanel-sentence')).toHaveLength(0)

    fireEvent.click(undo)
    await waitFor(() =>
      expect(screen.getAllByTestId('sidepanel-sentence')).toHaveLength(2)
    )
  })
})

describe('a definition in another language than the click assumed', () => {
  // An English card of "great" whose context request is still in flight.
  const olderCard = async () => {
    const late = deferred<unknown>()
    assumed = 'en'
    dictionary = () => enDefinition('great', 'older gloss')
    context = () => late.promise
    await openSentence()
    selectWord('great')
    await waitFor(() =>
      expect(sentTypes('translateWordInContext')).toHaveLength(1)
    )
    send.mockClear()
    assumed = 'zh-Hans'
    return late
  }

  it('records the actual language, replaces the older card and finishes the chain on the new one', async () => {
    const late = await olderCard()
    const answer = deferred<unknown>()
    dictionary = () => answer.promise
    context = () => ({ success: true, chinese: 'new meaning' })

    selectWord('great')
    await waitFor(() => expect(greatCards()).toHaveLength(2))
    await act(async () => answer.resolve(enDefinition('great', 'newer gloss')))

    await waitFor(() =>
      expect(greatCards()[0]).toHaveTextContent('new meaning')
    )
    expect(greatCards()).toHaveLength(1)
    expect(greatCards()[0]).toHaveTextContent('newer gloss')
    expect(sentTypes('translateWordInContext')).toHaveLength(1)
    expect(storedWords()).toEqual([
      expect.objectContaining({ explanationLanguage: 'en' }),
    ])

    await act(async () =>
      late.resolve({ success: true, chinese: 'stale meaning' })
    )
    expect(greatCards()[0]).not.toHaveTextContent('stale meaning')
  })

  it('waits for Undo after a Clear, then continues on the restored card', async () => {
    await olderCard()
    const answer = deferred<unknown>()
    dictionary = () => answer.promise
    context = () => ({ success: true, chinese: 'new meaning' })

    selectWord('great')
    await waitFor(() => expect(greatCards()).toHaveLength(2))
    fireEvent.click(screen.getByTestId('sidepanel-clear-all'))
    await screen.findByTestId('sidepanel-undo-clear')
    await act(async () => answer.resolve(enDefinition('great', 'newer gloss')))
    expect(sentTypes('translateWordInContext')).toHaveLength(0)

    fireEvent.click(screen.getByTestId('sidepanel-undo-clear'))

    await waitFor(() =>
      expect(greatCards()[0]).toHaveTextContent('new meaning')
    )
    expect(greatCards()).toHaveLength(1)
    expect(greatCards()[0]).toHaveTextContent('newer gloss')
    expect(sentTypes('translateWordInContext')).toHaveLength(1)
  })
})

describe('an English word card', () => {
  const mirror = (ecp: Record<string, unknown>) =>
    page(latestPageWordKey(TAB), { word: 'went', ecp }, 'evt-went')

  it('shows at most 8 senses with examples, the lemma note and both labelled pronunciations', async () => {
    render(<SidePanel />)
    await screen.findByTestId('sidepanel-empty-state')
    await mirror({
      English: 'went',
      Chinese: '',
      Pronunciation: 'ecdict-ipa',
      ExplanationLanguage: 'en',
      LemmaNote: 'past tense of go',
      PronunciationUS: '/wɛnt/',
      PronunciationUK: '/wɛnʔ/',
      Senses: Array.from({ length: 10 }, (_, i) => ({
        pos: 'verb',
        gloss: `gloss ${i + 1}.`,
        example: `example ${i + 1}.`,
      })),
    })

    const card = await screen.findByTestId('sidepanel-card-went')
    const senses = within(card).getAllByTestId('sidepanel-sense')
    expect(senses).toHaveLength(8)
    expect(senses[0]).toHaveTextContent('verb gloss 1.example 1.')
    expect(senses[7]).toHaveTextContent('gloss 8.')
    expect(card).toHaveTextContent('past tense of go')
    expect(card).toHaveTextContent('US /wɛnt/ · UK /wɛnʔ/')
    expect(card).not.toHaveTextContent('//')
    expect(card).not.toHaveTextContent('ecdict-ipa')
  })

  it('offers the speaker', async () => {
    render(<SidePanel />)
    await screen.findByTestId('sidepanel-empty-state')

    await mirror({
      English: 'went',
      Chinese: '',
      Pronunciation: '',
      ExplanationLanguage: 'en',
      Senses: [],
    })

    expect(
      await screen.findByTestId('sidepanel-play-pronunciation-went')
    ).toBeInTheDocument()
  })
})
