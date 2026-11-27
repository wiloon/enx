import { createStore } from 'jotai'
import {
  createPopoverLookupGate,
  rereadForExplanationLanguage,
} from '@/lib/explanationLanguageReread'
import {
  aiLookupAtom,
  currentWordAtom,
  errorAtom,
  isTranslatingAtom,
  sessionUnverifiedAtom,
  signedOutAtom,
} from '@/store/atoms'
import type { BackgroundResponse, WordData } from '@/types'

const chinese: WordData = {
  Id: 'cat-id',
  Key: 'cat',
  English: 'cat',
  Chinese: '猫',
  Pronunciation: 'kæt',
  WordType: 0,
  ExplanationLanguage: 'zh-Hans',
  LoadCount: 19,
  Known: true,
}

const english: WordData = {
  Id: 'cat-en',
  Key: 'cat',
  English: 'cat',
  Chinese: '',
  Pronunciation: '',
  WordType: 0,
  ExplanationLanguage: 'en',
  Senses: [{ pos: 'n', gloss: 'A small animal.' }],
}

const setup = () => {
  const store = createStore()
  store.set(currentWordAtom, chinese)
  const get = jest.fn(
    async (): Promise<BackgroundResponse> => ({
      success: true,
      ecp: english,
    })
  )
  const record = jest.fn(
    async (): Promise<BackgroundResponse> => ({
      success: true,
      queryCount: 99,
      known: false,
    })
  )
  const onMiss = jest.fn()
  return { store, get, record, onMiss }
}

it('shows the new language, preserves LoadCount/Known, and never records a lookup', async () => {
  const { store, get, record, onMiss } = setup()

  await rereadForExplanationLanguage('cat', 'en', {
    store,
    state: chinese,
    get,
    record,
    isActive: () => true,
    isCurrent: () => true,
    onMiss,
  })

  expect(record).not.toHaveBeenCalled()
  expect(store.get(currentWordAtom)).toEqual(
    expect.objectContaining({
      ExplanationLanguage: 'en',
      Senses: [{ pos: 'n', gloss: 'A small animal.' }],
      LoadCount: 19,
      Known: true,
    })
  )
  expect(store.get(isTranslatingAtom)).toBe(false)
  expect(onMiss).toHaveBeenCalledWith(
    expect.objectContaining({ ExplanationLanguage: 'en', LoadCount: 19 })
  )
})

it('drops a late answer once the gate has moved on', async () => {
  const { store, get, record, onMiss } = setup()
  let resolve!: (r: BackgroundResponse) => void
  get.mockImplementation(
    () =>
      new Promise<BackgroundResponse>(r => {
        resolve = r
      })
  )
  const gate = createPopoverLookupGate()
  const switchGate = gate.beginSwitch('en')

  const pending = rereadForExplanationLanguage('cat', 'en', {
    store,
    state: chinese,
    get,
    record,
    isActive: () => true,
    isCurrent: () => switchGate.isCurrent(),
    onMiss,
  })
  expect(store.get(isTranslatingAtom)).toBe(true)

  gate.beginSwitch('zh-Hans')
  resolve({ success: true, ecp: english })
  await pending

  expect(store.get(currentWordAtom)).toEqual(chinese)
  expect(onMiss).not.toHaveBeenCalled()
})

it('clears translating when the answer language does not match the switch', async () => {
  const { store, get, record, onMiss } = setup()
  get.mockResolvedValue({
    success: true,
    ecp: { ...english, ExplanationLanguage: 'zh-Hans' },
  })

  await rereadForExplanationLanguage('cat', 'en', {
    store,
    state: chinese,
    get,
    record,
    isActive: () => true,
    isCurrent: () => true,
    onMiss,
  })

  expect(store.get(currentWordAtom)).toEqual(chinese)
  expect(store.get(isTranslatingAtom)).toBe(false)
  expect(onMiss).not.toHaveBeenCalled()
})

it('shows signed-out when the re-read fails that way', async () => {
  const { store, get, record, onMiss } = setup()
  get.mockResolvedValue({ success: false, sessionExpired: true })

  await rereadForExplanationLanguage('cat', 'en', {
    store,
    state: chinese,
    get,
    record,
    isActive: () => true,
    isCurrent: () => true,
    onMiss,
  })

  expect(store.get(signedOutAtom)).toBe(true)
  expect(store.get(isTranslatingAtom)).toBe(false)
  expect(onMiss).not.toHaveBeenCalled()
})

it('shows the unverified notice when the re-read fails that way', async () => {
  const { store, get, record, onMiss } = setup()
  get.mockResolvedValue({ success: false, sessionUnverified: true })

  await rereadForExplanationLanguage('cat', 'en', {
    store,
    state: chinese,
    get,
    record,
    isActive: () => true,
    isCurrent: () => true,
    onMiss,
  })

  expect(store.get(sessionUnverifiedAtom)).toBe('lookup')
  expect(store.get(isTranslatingAtom)).toBe(false)
})

it('resets any AI offer before the re-read', async () => {
  const { store, get, record, onMiss } = setup()
  store.set(aiLookupAtom, { status: 'offer', canUse: true })

  await rereadForExplanationLanguage('cat', 'en', {
    store,
    state: chinese,
    get,
    record,
    isActive: () => true,
    isCurrent: () => true,
    onMiss,
  })

  expect(store.get(aiLookupAtom)).toEqual({ status: 'idle' })
})

it('offers AI on a dictionary miss after the re-read', async () => {
  const { store, get, record, onMiss } = setup()
  const miss: WordData = {
    Id: '',
    Key: 'zorbly',
    English: 'zorbly',
    Chinese: '',
    Pronunciation: '',
    WordType: 0,
    ExplanationLanguage: 'en',
    AIFallback: { CanUse: true, Auto: false },
  }
  get.mockResolvedValue({ success: true, ecp: miss })

  await rereadForExplanationLanguage('zorbly', 'en', {
    store,
    state: chinese,
    get,
    record,
    isActive: () => true,
    isCurrent: () => true,
    onMiss,
  })

  expect(onMiss).toHaveBeenCalledWith(
    expect.objectContaining({ AIFallback: { CanUse: true, Auto: false } })
  )
  expect(store.get(errorAtom)).toBeNull()
})

it('an initial lookup is dropped once a language switch begins', () => {
  const gate = createPopoverLookupGate()
  const initial = gate.beginInitial()
  expect(initial.isCurrent()).toBe(true)
  gate.beginSwitch('en')
  expect(initial.isCurrent()).toBe(false)
})
