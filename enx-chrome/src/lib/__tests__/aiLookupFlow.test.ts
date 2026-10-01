import { createStore } from 'jotai'
import {
  handleLookupMiss,
  resetAiLookup,
  runAiLookup,
  type AiLookupDeps,
} from '@/lib/aiLookupFlow'
import {
  acknowledgeAiNotice,
  lookupWithAi,
  shouldShowAiNotice,
} from '@/lib/aiLookup'
import { aiLookupAtom, aiNoticeAtom, currentWordAtom } from '@/store/atoms'
import type { WordData } from '@/types'

jest.mock('@/lib/aiLookup', () => ({
  lookupWithAi: jest.fn(),
  shouldShowAiNotice: jest.fn(),
  acknowledgeAiNotice: jest.fn(),
}))

const lookup = lookupWithAi as jest.Mock
const shouldShow = shouldShowAiNotice as jest.Mock
const acknowledge = acknowledgeAiNotice as jest.Mock

const miss = (fallback?: { CanUse: boolean; Auto: boolean }): WordData => ({
  Key: 'rizzler',
  English: 'rizzler',
  Pronunciation: '',
  Chinese: '',
  LoadCount: 0,
  AlreadyAcquainted: 0,
  WordType: 0,
  ...(fallback ? { AIFallback: fallback } : {}),
})

const defined: WordData = {
  ...miss(),
  Id: 'w1',
  Chinese: 'n. 很有魅力的人',
  Origin: 'ai',
} as WordData

// Resolves once everything the flow started has settled.
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

function setup(overrides: Partial<AiLookupDeps> = {}) {
  const store = createStore()
  store.set(currentWordAtom, miss())
  const deps = {
    store,
    isCurrent: jest.fn(() => true),
    onDefined: jest.fn(),
    onSessionExpired: jest.fn(),
    ...overrides,
  } satisfies AiLookupDeps
  return { store, deps }
}

beforeEach(() => {
  jest.resetAllMocks()
  shouldShow.mockResolvedValue(false)
  acknowledge.mockResolvedValue(undefined)
})

describe('handleLookupMiss', () => {
  it('starts the AI lookup by itself when the server says Auto', async () => {
    lookup.mockResolvedValue({ kind: 'found', word: defined })
    const { store, deps } = setup()

    handleLookupMiss(miss({ CanUse: true, Auto: true }), deps)
    expect(store.get(aiLookupAtom)).toEqual({ status: 'loading' })
    await settle()

    expect(lookup).toHaveBeenCalledWith('rizzler')
    expect(store.get(aiLookupAtom)).toEqual({ status: 'found' })
  })

  it.each([
    [true, { status: 'offer', canUse: true }],
    // The user can't use AI yet: the button leads to billing instead.
    [false, { status: 'offer', canUse: false }],
  ])(
    'offers a button, and runs nothing, when Auto is off (CanUse %s)',
    (canUse, expected) => {
      const { store, deps } = setup()

      handleLookupMiss(miss({ CanUse: canUse, Auto: false }), deps)

      expect(store.get(aiLookupAtom)).toEqual(expected)
      expect(lookup).not.toHaveBeenCalled()
    }
  )

  it('does nothing for a server that does not mention AI', () => {
    const { store, deps } = setup()

    handleLookupMiss(miss(), deps)

    expect(store.get(aiLookupAtom)).toEqual({ status: 'idle' })
    expect(lookup).not.toHaveBeenCalled()
  })

  it('does nothing for a word that was found, whatever the fallback says', () => {
    const { store, deps } = setup()

    handleLookupMiss(
      { ...miss({ CanUse: true, Auto: true }), Chinese: 'v. 跑' },
      deps
    )

    expect(store.get(aiLookupAtom)).toEqual({ status: 'idle' })
    expect(lookup).not.toHaveBeenCalled()
  })
})

describe('runAiLookup', () => {
  it('puts the definition in the popup and hands it to the content script', async () => {
    lookup.mockResolvedValue({ kind: 'found', word: defined })
    const { store, deps } = setup()

    await runAiLookup('rizzler', { auto: false }, deps)

    expect(store.get(currentWordAtom)).toMatchObject({
      Chinese: 'n. 很有魅力的人',
      Origin: 'ai',
    })
    expect(store.get(aiLookupAtom)).toEqual({ status: 'found' })
    expect(deps.onDefined).toHaveBeenCalledWith(defined)
  })

  it('shows "loading" while the request is out', async () => {
    let finish: (v: unknown) => void = () => {}
    lookup.mockReturnValue(new Promise(resolve => (finish = resolve)))
    const { store, deps } = setup()

    const running = runAiLookup('rizzler', { auto: true }, deps)
    expect(store.get(aiLookupAtom)).toEqual({ status: 'loading' })

    finish({ kind: 'none' })
    await running
    expect(store.get(aiLookupAtom)).toEqual({ status: 'none' })
  })

  it.each([
    ['credit'],
    ['rate-limited'],
    ['not-entitled'],
    ['unavailable'],
  ] as const)('shows a %s error', async reason => {
    lookup.mockResolvedValue({ kind: 'error', reason })
    const { store, deps } = setup()

    await runAiLookup('rizzler', { auto: false }, deps)

    expect(store.get(aiLookupAtom)).toEqual({ status: 'error', reason })
    expect(deps.onDefined).not.toHaveBeenCalled()
  })

  it('hands an expired session to the content script and shows nothing', async () => {
    lookup.mockResolvedValue({ kind: 'session-expired' })
    const { deps } = setup()

    await runAiLookup('rizzler', { auto: false }, deps)

    expect(deps.onSessionExpired).toHaveBeenCalledTimes(1)
  })

  // The request cannot be cancelled, so the user may have moved on by the
  // time it answers: that answer must not land in a different popup.
  it('ignores an answer that arrives after the popup was replaced', async () => {
    lookup.mockResolvedValue({ kind: 'found', word: defined })
    const { store, deps } = setup({ isCurrent: jest.fn(() => false) })
    store.set(currentWordAtom, { ...miss(), English: 'another' })

    await runAiLookup('rizzler', { auto: true }, deps)

    expect(store.get(currentWordAtom)).toMatchObject({ English: 'another' })
    expect(deps.onDefined).not.toHaveBeenCalled()
    expect(deps.onSessionExpired).not.toHaveBeenCalled()
    expect(shouldShow).not.toHaveBeenCalled()
  })
})

describe('the one-time notice', () => {
  it('is shown once with the first AI result, and recorded as seen', async () => {
    lookup.mockResolvedValue({ kind: 'found', word: defined })
    shouldShow.mockResolvedValue(true)
    const { store, deps } = setup()

    await runAiLookup('rizzler', { auto: false }, deps)

    expect(store.get(aiNoticeAtom)).toEqual({ show: true, offerStop: false })
    expect(acknowledge).toHaveBeenCalledTimes(1)
  })

  it('offers to stop only when the lookup ran by itself', async () => {
    lookup.mockResolvedValue({ kind: 'found', word: defined })
    shouldShow.mockResolvedValue(true)
    const { store, deps } = setup()

    await runAiLookup('rizzler', { auto: true }, deps)

    expect(store.get(aiNoticeAtom)).toEqual({ show: true, offerStop: true })
  })

  it('is not shown again once it has been seen', async () => {
    lookup.mockResolvedValue({ kind: 'found', word: defined })
    shouldShow.mockResolvedValue(false)
    const { store, deps } = setup()

    await runAiLookup('rizzler', { auto: true }, deps)

    expect(store.get(aiNoticeAtom)).toEqual({ show: false, offerStop: false })
    expect(acknowledge).not.toHaveBeenCalled()
  })

  it.each([
    ['no definition', { kind: 'none' }],
    ['an error', { kind: 'error', reason: 'unavailable' }],
  ])(
    'is not shown for %s: nothing was sent that the user saw an answer to',
    async (_name, outcome) => {
      lookup.mockResolvedValue(outcome)
      shouldShow.mockResolvedValue(true)
      const { store, deps } = setup()

      await runAiLookup('rizzler', { auto: true }, deps)

      expect(store.get(aiNoticeAtom).show).toBe(false)
      expect(acknowledge).not.toHaveBeenCalled()
    }
  )
})

describe('resetAiLookup', () => {
  it('clears what the last popup left behind', () => {
    const { store } = setup()
    store.set(aiLookupAtom, { status: 'found' })
    store.set(aiNoticeAtom, { show: true, offerStop: true })

    resetAiLookup(store)

    expect(store.get(aiLookupAtom)).toEqual({ status: 'idle' })
    expect(store.get(aiNoticeAtom)).toEqual({ show: false, offerStop: false })
  })
})
