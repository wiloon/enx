import { act, fireEvent, render, screen } from '@testing-library/react'
import { Provider, createStore } from 'jotai'
import WordPopover from '@/components/WordPopover'
import {
  fetchPreferences,
  readCachedPreferences,
  updatePreferences,
  type PreferencesData,
  type PreferencesResult,
} from '@/lib/serverPreferences'
import {
  lookupNoticeAtom,
  sessionUnverifiedAtom,
  signedOutAtom,
} from '@/store/atoms'

jest.mock('@/lib/aiLookup', () => ({
  billingUrl: (src: string) => `https://enx.example.test/billing?src=${src}`,
  stopAutomaticAiLookup: jest.fn(),
}))
jest.mock('@/lib/serverPreferences', () => ({
  fetchPreferences: jest.fn(),
  readCachedPreferences: jest.fn(),
  updatePreferences: jest.fn(),
}))

const fetchMock = fetchPreferences as jest.Mock
const cacheMock = readCachedPreferences as jest.Mock
const updateMock = updatePreferences as jest.Mock

const flag = { value: null, effective: false, editable: true }

const prefs = (language?: string): PreferencesData => ({
  aiWordFallback: flag,
  aiWordFallbackNoticeAck: flag,
  ...(language
    ? {
        explanationLanguage: {
          value: language,
          effective: language,
          editable: true,
        },
      }
    : {}),
})

const ok = (language?: string): PreferencesResult => ({
  ok: true,
  data: prefs(language),
})
const unavailable: PreferencesResult = {
  ok: false,
  reason: 'unavailable',
  error: 'HTTP 500',
}

// A request the test answers by hand.
const pending = () => {
  let answer: (result: PreferencesResult) => void = () => {}
  const promise = new Promise<PreferencesResult>(resolve => {
    answer = resolve
  })
  return { promise, answer: (r: PreferencesResult) => act(async () => answer(r)) }
}

const open = async (
  setUp: (store: ReturnType<typeof createStore>) => void = () => {},
  variant: 'dictionary' | 'hint' = 'dictionary'
) => {
  const store = createStore()
  setUp(store)
  await act(async () => {
    render(
      <Provider store={store}>
        <WordPopover
          word="light"
          variant={variant}
          onClose={jest.fn()}
          onMarkKnown={jest.fn()}
          onOpenSentencePanel={jest.fn()}
        />
      </Provider>
    )
  })
}

const chinese = () =>
  screen.getByRole('button', { name: 'Simplified Chinese' })
const english = () => screen.getByRole('button', { name: 'English' })
const noSwitch = () =>
  expect(
    screen.queryByRole('group', { name: 'Explanation language' })
  ).toBeNull()
const selected = () =>
  [chinese(), english()]
    .filter(b => b.getAttribute('aria-pressed') === 'true')
    .map(b => b.textContent)

beforeEach(() => {
  jest.resetAllMocks()
  cacheMock.mockResolvedValue(null)
})

describe('the explanation language switch on the word popover (ADR-098)', () => {
  it('shows the cached value, disabled, until the server answers', async () => {
    cacheMock.mockResolvedValue(prefs('zh-Hans'))
    const read = pending()
    fetchMock.mockReturnValue(read.promise)
    await open()

    expect(chinese()).toHaveTextContent('中')
    expect(english()).toHaveTextContent('EN')
    expect(selected()).toEqual(['中'])
    expect(chinese()).toBeDisabled()
    expect(english()).toBeDisabled()

    await read.answer(ok('en'))

    expect(selected()).toEqual(['EN'])
    expect(chinese()).toBeEnabled()
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('saves the other side on click, disabled while saving', async () => {
    fetchMock.mockResolvedValue(ok('zh-Hans'))
    const save = pending()
    updateMock.mockReturnValue(save.promise)
    await open()

    fireEvent.click(english())

    expect(updateMock).toHaveBeenCalledWith({ explanationLanguage: 'en' })
    expect(selected()).toEqual(['EN'])
    expect(chinese()).toBeDisabled()
    expect(english()).toBeDisabled()

    await save.answer(ok('en'))

    expect(selected()).toEqual(['EN'])
    expect(english()).toBeEnabled()
  })

  it('sends nothing when the selected side is clicked', async () => {
    fetchMock.mockResolvedValue(ok('zh-Hans'))
    await open()

    fireEvent.click(chinese())

    expect(updateMock).not.toHaveBeenCalled()
  })

  it('goes back and says so when saving fails', async () => {
    fetchMock.mockResolvedValue(ok('zh-Hans'))
    updateMock.mockResolvedValue(unavailable)
    await open()

    await act(async () => {
      fireEvent.click(english())
    })

    expect(selected()).toEqual(['中'])
    expect(english()).toBeEnabled()
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Couldn't save the explanation language."
    )
  })

  it('selects nothing for a value it does not know, and writes nothing', async () => {
    fetchMock.mockResolvedValue(ok('zh-Hant'))
    await open()

    expect(selected()).toEqual([])
    expect(english()).toBeEnabled()
    expect(updateMock).not.toHaveBeenCalled()
  })

  it.each([
    ['a known value', 'en', ['EN']],
    ['a value it does not know', 'zh-Hant', []],
  ])(
    'keeps %s from the cache, disabled, when the read fails',
    async (_name, cached, shown) => {
      cacheMock.mockResolvedValue(prefs(cached))
      fetchMock.mockResolvedValue(unavailable)
      await open()

      expect(selected()).toEqual(shown)
      expect(chinese()).toBeDisabled()
      expect(english()).toBeDisabled()
      expect(screen.queryByRole('alert')).toBeNull()
    }
  )

  it.each([
    ['the read fails with nothing cached', null, unavailable],
    ['the server does not send the preference', null, ok()],
    ['an older server answers over a cached value', prefs('en'), ok()],
    [
      'the session is signed out',
      prefs('en'),
      { ok: false, reason: 'signed-out', error: 'Not signed in' },
    ],
  ])('is hidden when %s', async (_name, cached, result) => {
    cacheMock.mockResolvedValue(cached)
    fetchMock.mockResolvedValue(result)
    await open()

    noSwitch()
  })

  it.each<[string, (store: ReturnType<typeof createStore>) => void]>([
    ['the signed-out notice', store => store.set(signedOutAtom, true)],
    [
      'the unverified notice',
      store => store.set(sessionUnverifiedAtom, 'lookup'),
    ],
    [
      'a signed-out lookup notice',
      store =>
        store.set(lookupNoticeAtom, {
          error: 'Session expired',
          sessionExpired: true,
        }),
    ],
  ])('is hidden next to %s', async (_name, setUp) => {
    fetchMock.mockResolvedValue(ok('en'))
    await open(setUp)

    noSwitch()
  })

  it('is not part of the hint variant', async () => {
    fetchMock.mockResolvedValue(ok('en'))
    await open(() => {}, 'hint')

    noSwitch()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
