import { createStore } from 'jotai'
import { lookupWithAi } from '@/lib/aiLookup'
import { runAiLookup, type AiLookupDeps } from '@/lib/aiLookupFlow'
import { createPopoverLookupGate } from '@/lib/explanationLanguageReread'
import { bindPopoverAiLookupGate } from '@/lib/popoverAiLookupGate'
import { currentWordAtom } from '@/store/atoms'
import type { WordData } from '@/types'

jest.mock('@/lib/aiLookup', () => ({
  lookupWithAi: jest.fn(),
  shouldShowAiNotice: jest.fn().mockResolvedValue(false),
  acknowledgeAiNotice: jest.fn(),
}))

const lookup = lookupWithAi as jest.Mock

const defined: WordData = {
  Id: 'w1',
  Key: 'rizzler',
  English: 'rizzler',
  Pronunciation: '',
  Chinese: '',
  WordType: 0,
  Origin: 'ai',
  ExplanationLanguage: 'en',
  Senses: [{ pos: 'noun', gloss: 'A stylish person.', example: 'He is.' }],
}

function baseDeps(onDefined = jest.fn()): AiLookupDeps {
  return {
    store: createStore(),
    isCurrent: () => true,
    onDefined,
    recordLookup: jest.fn().mockResolvedValue({ success: true }),
  }
}

beforeEach(() => {
  jest.resetAllMocks()
  lookup.mockResolvedValue({ kind: 'found', word: defined })
})

it('drops a late AI answer started before beginSwitch', async () => {
  const gate = createPopoverLookupGate()
  const initial = gate.beginInitial()
  const onDefined = jest.fn()
  const deps = bindPopoverAiLookupGate(baseDeps(onDefined), initial)
  const store = deps.store
  store.set(currentWordAtom, {
    Key: 'rizzler',
    English: 'rizzler',
    Pronunciation: '',
    Chinese: '',
    WordType: 0,
    ExplanationLanguage: 'en',
  })

  let finish: (v: unknown) => void = () => {}
  lookup.mockReturnValue(new Promise(resolve => (finish = resolve)))

  const pending = runAiLookup('rizzler', { auto: false }, deps)
  gate.beginSwitch('zh-Hans')
  finish({ kind: 'found', word: defined })
  await pending

  expect(store.get(currentWordAtom)?.Origin).toBeUndefined()
  expect(onDefined).not.toHaveBeenCalled()
})

it('applies an AI answer started after beginSwitch', async () => {
  const gate = createPopoverLookupGate()
  gate.beginInitial()
  const switchGate = gate.beginSwitch('en')
  const onDefined = jest.fn()
  const deps = bindPopoverAiLookupGate(baseDeps(onDefined), switchGate)

  await runAiLookup('rizzler', { auto: true }, deps)

  expect(deps.store.get(currentWordAtom)?.Origin).toBe('ai')
  expect(onDefined).toHaveBeenCalled()
})
