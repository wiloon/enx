import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'

jest.mock('@/lib/sentry', () => ({ initSentry: jest.fn() }))
jest.mock('@/config/env', () => ({
  config: { frontendBaseUrl: 'http://localhost:3000' },
}))
jest.mock('@/services/api', () => ({ sendMessageToBackground: jest.fn() }))
jest.mock('@/lib/pronunciation', () => ({ playPronunciation: jest.fn() }))

import { sendMessageToBackground } from '@/services/api'
import { playPronunciation } from '@/lib/pronunciation'
import { latestPageWordKey, pendingSentenceKey } from '@/lib/sidePanel'
import SidePanel from '../SidePanel'

const PANEL_TAB_ID = 7
const SENTENCE = 'Cats are great pets.'

const send = sendMessageToBackground as jest.Mock
const play = playPronunciation as jest.Mock

type Message = { type: string; word?: string }
type Handler = (message: Message) => unknown

// Answers each background message by type; anything unlisted fails.
const answer = (handlers: Record<string, Handler>) =>
  send.mockImplementation(async (message: Message) =>
    handlers[message.type]
      ? handlers[message.type](message)
      : { success: false }
  )

const pending = () => new Promise<never>(() => {})

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => (resolve = r))
  return { promise, resolve }
}

const defined = (Pronunciation = '') => ({
  success: true,
  ecp: {
    English: 'great',
    Chinese: 'adj. 很棒的',
    Pronunciation,
    LoadCount: 1,
  },
})

const speakerOf = (word: string) =>
  screen.queryByTestId(`sidepanel-play-pronunciation-${word}`)

const anySpeaker = () =>
  screen.queryAllByTestId(/^sidepanel-play-pronunciation-/)

type StorageChangeListener = (
  changes: { [key: string]: chrome.storage.StorageChange },
  areaName: string
) => void

let storageChangeListeners: StorageChangeListener[]

const mirrorPageLookup = (ecp: Record<string, unknown>) =>
  act(() => {
    storageChangeListeners.forEach(listener =>
      listener(
        {
          [latestPageWordKey(PANEL_TAB_ID)]: {
            newValue: { word: 'rizzler', ecp, createdAt: 1 },
          },
        },
        'session'
      )
    )
  })

const seed = (context: Record<string, unknown>) =>
  (chrome.storage.session.get as jest.Mock).mockResolvedValue({
    [pendingSentenceKey(PANEL_TAB_ID)]: { word: '', createdAt: 1, ...context },
  })

// Opens the panel on SENTENCE and looks up "great" inside it.
const lookUpGreat = async () => {
  seed({ sentence: SENTENCE })
  render(<SidePanel />)
  await screen.findByTestId('sidepanel-sentence')
  selectWord('great')
  return screen.findByTestId('sidepanel-card-great')
}

// Selects `text` in the rendered sentence the way a mouse drag would.
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

beforeEach(() => {
  jest.clearAllMocks()
  window.history.replaceState({}, '', `/sidepanel.html?tabId=${PANEL_TAB_ID}`)
  storageChangeListeners = []
  CSS.highlights.clear()
  ;(chrome.storage.session.get as jest.Mock).mockResolvedValue({})
  ;(chrome.storage.local.get as jest.Mock).mockResolvedValue({})
  ;(chrome.tabs.sendMessage as jest.Mock).mockResolvedValue(undefined)
  ;(chrome.storage.onChanged.addListener as jest.Mock).mockImplementation(
    (listener: StorageChangeListener) => storageChangeListeners.push(listener)
  )
  ;(chrome.storage.onChanged.removeListener as jest.Mock).mockImplementation(
    () => {}
  )
})

describe('a word card', () => {
  it('offers no speaker while its definition loads, then the speaker alone without a phonetic', async () => {
    const dictionary = deferred<unknown>()
    answer({
      translateSentence: () => ({ success: true, chinese: '猫是很棒的宠物。' }),
      getOneWord: () => dictionary.promise,
      translateWordInContext: pending,
    })
    const card = await lookUpGreat()

    expect(card).toHaveTextContent('Loading phonetics...')
    expect(speakerOf('great')).toBeNull()

    await act(async () => dictionary.resolve(defined()))

    // The AI half is still loading; the definition alone enables the speaker.
    expect(card).toHaveTextContent('adj. 很棒的')
    expect(card).not.toHaveTextContent('Loading phonetics')
    fireEvent.click(
      within(card).getByTestId('sidepanel-play-pronunciation-great')
    )
    expect(play).toHaveBeenCalledTimes(1)
    expect(play).toHaveBeenCalledWith('great')
  })

  it('shows the phonetic beside the speaker when there is one, as before', async () => {
    answer({
      translateSentence: () => ({ success: true, chinese: '猫是很棒的宠物。' }),
      getOneWord: () => defined('greɪt'),
      translateWordInContext: () => ({ success: true, chinese: '很棒的' }),
    })
    const card = await lookUpGreat()

    await waitFor(() => expect(card).toHaveTextContent('/greɪt/'))
    fireEvent.click(
      within(card).getByTestId('sidepanel-play-pronunciation-great')
    )
    expect(play).toHaveBeenCalledWith('great')
  })

  it('keeps the speaker when the in-context translation failed', async () => {
    answer({
      translateSentence: () => ({ success: true, chinese: '猫是很棒的宠物。' }),
      getOneWord: () => defined(),
      translateWordInContext: () => ({
        success: false,
        error: 'translation service unavailable',
      }),
    })
    const card = await lookUpGreat()

    await waitFor(() =>
      expect(card).toHaveTextContent('translation service unavailable')
    )
    expect(speakerOf('great')).toBeInTheDocument()
  })

  it('offers no speaker when its dictionary lookup failed', async () => {
    const dictionary = deferred<unknown>()
    answer({
      translateSentence: () => ({ success: true, chinese: '猫是很棒的宠物。' }),
      getOneWord: () => dictionary.promise,
      translateWordInContext: pending,
    })
    const card = await lookUpGreat()

    await act(async () =>
      dictionary.resolve({ success: false, error: 'Dictionary lookup failed' })
    )

    expect(card).toHaveTextContent('Dictionary lookup failed')
    expect(speakerOf('great')).toBeNull()
  })

  it('offers no speaker for a dictionary miss, even once the in-context translation arrives', async () => {
    answer({
      translateSentence: () => ({ success: true, chinese: '猫是很棒的宠物。' }),
      getOneWord: () => ({
        success: true,
        ecp: { English: 'great', Chinese: '', Pronunciation: 'greɪt' },
      }),
      translateWordInContext: () => ({ success: true, chinese: '很棒的' }),
    })
    const card = await lookUpGreat()

    await waitFor(() => expect(card).toHaveTextContent('很棒的'))
    expect(speakerOf('great')).toBeNull()
  })
})

describe('a word mirrored from the page popover', () => {
  it('offers the speaker for an AI definition without a phonetic, playing the card word', async () => {
    render(<SidePanel />)
    await screen.findByTestId('sidepanel-empty-state')

    mirrorPageLookup({
      English: 'rizzler',
      Chinese: 'n. 很有魅力的人',
      Pronunciation: '',
      Origin: 'ai',
    })

    fireEvent.click(
      await screen.findByTestId('sidepanel-play-pronunciation-rizzler')
    )
    expect(play).toHaveBeenCalledTimes(1)
    expect(play).toHaveBeenCalledWith('rizzler')
  })

  it('offers no speaker for a dictionary miss', async () => {
    render(<SidePanel />)
    await screen.findByTestId('sidepanel-empty-state')

    mirrorPageLookup({
      English: 'rizzler',
      Chinese: '',
      Pronunciation: 'rɪzlə',
    })

    await screen.findByTestId('sidepanel-card-rizzler')
    expect(speakerOf('rizzler')).toBeNull()
  })
})

describe('a phrase card never offers a speaker', () => {
  const PHRASE_SENTENCE = 'Hunt down emails before noon.'

  it('at the top level, while its translation loads and once it arrives', async () => {
    const context = deferred<unknown>()
    seed({ sentence: PHRASE_SENTENCE, phrase: 'hunt down emails' })
    answer({ translateWordInContext: () => context.promise })
    render(<SidePanel />)

    const card = await screen.findByTestId('sidepanel-card-hunt down emails')
    expect(anySpeaker()).toHaveLength(0)

    await act(async () =>
      context.resolve({ success: true, chinese: '找到邮箱地址' })
    )

    expect(card).toHaveTextContent('找到邮箱地址')
    expect(anySpeaker()).toHaveLength(0)
  })

  it('at the top level, when its translation failed', async () => {
    seed({ sentence: PHRASE_SENTENCE, phrase: 'hunt down emails' })
    answer({
      translateWordInContext: () => ({
        success: false,
        error: 'translation service unavailable',
      }),
    })
    render(<SidePanel />)

    const card = await screen.findByTestId('sidepanel-card-hunt down emails')
    await waitFor(() =>
      expect(card).toHaveTextContent('translation service unavailable')
    )
    expect(anySpeaker()).toHaveLength(0)
  })

  it('nested in a sentence', async () => {
    const user = userEvent.setup()
    seed({ sentence: SENTENCE })
    answer({
      translateSentence: () => ({ success: true, chinese: '猫是很棒的宠物。' }),
      translateWordInContext: () => ({ success: true, chinese: '很棒的宠物' }),
    })
    render(<SidePanel />)
    await screen.findByTestId('sidepanel-sentence')

    selectWord('great pets')
    await user.click(await screen.findByTestId('sidepanel-phrase-confirm'))

    const card = await screen.findByTestId('sidepanel-card-great pets')
    await waitFor(() => expect(card).toHaveTextContent('很棒的宠物'))
    expect(anySpeaker()).toHaveLength(0)
  })
})
