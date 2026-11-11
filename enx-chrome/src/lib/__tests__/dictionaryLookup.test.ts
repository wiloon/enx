import { runDictionaryLookup } from '@/lib/dictionaryLookup'
import type { BackgroundResponse, WordData } from '@/types'

// What the worker answers: a cached entry carries no user state, and a
// QUERY answer never does (ADR-079 Decision 1).
const word: WordData = {
  Id: 'cat-id',
  Key: 'cat',
  English: 'cat',
  Chinese: '猫',
  Pronunciation: 'kæt',
  WordType: 0,
}
const setup = () => ({
  get: jest.fn(
    async (_word: string, _refresh?: boolean): Promise<BackgroundResponse> => ({
      success: true,
      ecp: word,
    })
  ),
  record: jest.fn(async (_wordId: string): Promise<BackgroundResponse> => ({
    success: true,
    queryCount: 5,
    known: false,
  })),
  onDefinition: jest.fn(),
  onCounted: jest.fn(),
  onFailure: jest.fn(),
  onRecordFailure: jest.fn(),
  isActive: () => true,
  isCurrent: () => true,
})

it('shows the definition without a count while the one recording POST is pending', async () => {
  const deps = setup()
  let resolve!: (r: BackgroundResponse) => void
  deps.record.mockImplementation(
    () =>
      new Promise(r => {
        resolve = r
      })
  )
  const done = runDictionaryLookup('cat', { counts: true }, deps)
  await Promise.resolve()
  expect(deps.onDefinition).toHaveBeenCalledWith(
    expect.objectContaining({
      Chinese: '猫',
      LoadCount: undefined,
      Known: undefined,
    })
  )
  expect(deps.onCounted).not.toHaveBeenCalled()
  expect(deps.record.mock.calls).toEqual([['cat-id']])
  resolve({ success: true, queryCount: 12, known: true })
  await done
  expect(deps.onCounted).toHaveBeenCalledWith(
    expect.objectContaining({ LoadCount: 12, Known: true })
  )
})

it.each([
  { status: 429, code: 'lookup_quota_exceeded', error: 'Quota reached' },
  { status: 429, code: 'too_many_requests', error: 'Slow down' },
  { status: 401, sessionExpired: true, error: 'Sign in again' },
  { status: 401, sessionUnverified: true, error: 'Unverified' },
])(
  'keeps the definition and reports a refused POST under it: %j',
  async failure => {
    const deps = setup()
    deps.record.mockResolvedValue({ success: false, ...failure })
    await runDictionaryLookup('cat', { counts: true }, deps)
    expect(deps.onDefinition).toHaveBeenCalledTimes(1)
    expect(deps.onRecordFailure).toHaveBeenCalledWith({
      success: false,
      ...failure,
    })
    expect(deps.onFailure).not.toHaveBeenCalled()
    expect(deps.onCounted).not.toHaveBeenCalled()
  }
)

it('recovers a deleted id through a fresh read and one more POST', async () => {
  const deps = setup()
  deps.record.mockResolvedValueOnce({ success: false, status: 404 })
  deps.get
    .mockResolvedValueOnce({ success: true, ecp: word })
    .mockResolvedValueOnce({
      success: true,
      ecp: { ...word, Id: 'new-cat-id', Chinese: '新释义' },
    })
  await runDictionaryLookup('cat', { counts: true }, deps)
  expect(deps.get).toHaveBeenLastCalledWith('cat', true)
  expect(deps.record.mock.calls).toEqual([['cat-id'], ['new-cat-id']])
  expect(deps.onCounted).toHaveBeenCalledWith(
    expect.objectContaining({
      Id: 'new-cat-id',
      LoadCount: 5,
      Chinese: '新释义',
    })
  )
})

it('reports a failed refresh after a 404 under the definition', async () => {
  const deps = setup()
  deps.record.mockResolvedValueOnce({ success: false, status: 404 })
  deps.get
    .mockResolvedValueOnce({ success: true, ecp: word })
    .mockResolvedValueOnce({ success: false, status: 429 })
  await runDictionaryLookup('cat', { counts: true }, deps)
  expect(deps.onRecordFailure).toHaveBeenCalledWith({
    success: false,
    status: 429,
  })
  expect(deps.onFailure).not.toHaveBeenCalled()
})

it.each([
  { success: false, status: 503 },
  { success: false, error: 'Offline' },
])(
  'keeps the definition without changing state or retrying on %j',
  async failure => {
    const deps = setup()
    deps.record.mockResolvedValue(failure)
    await runDictionaryLookup('cat', { counts: true }, deps)
    expect(deps.onDefinition).toHaveBeenCalledTimes(1)
    expect(deps.onCounted).not.toHaveBeenCalled()
    expect(deps.onFailure).not.toHaveBeenCalled()
    expect(deps.onRecordFailure).not.toHaveBeenCalled()
    expect(deps.record).toHaveBeenCalledTimes(1)
  }
)

it('a rejected POST keeps the definition and is never retried', async () => {
  const deps = setup()
  deps.record.mockRejectedValue(new TypeError('Offline'))
  expect(
    (await runDictionaryLookup('cat', { counts: true }, deps))?.Chinese
  ).toBe('猫')
  expect(deps.record).toHaveBeenCalledTimes(1)
})

it('shows a definition without an Id and neither records it nor changes word state', async () => {
  const deps = setup()
  deps.get.mockResolvedValue({ success: true, ecp: { ...word, Id: undefined } })
  await runDictionaryLookup('cat', { counts: true }, deps)
  expect(deps.onDefinition).toHaveBeenCalledWith(
    expect.objectContaining({ Chinese: '猫' })
  )
  expect(deps.record).not.toHaveBeenCalled()
  expect(deps.onCounted).not.toHaveBeenCalled()
})

it('returns a word no dictionary knows with its AI offer and records nothing', async () => {
  const deps = setup()
  const miss: WordData = {
    Key: 'zorbly',
    English: 'zorbly',
    Pronunciation: '',
    Chinese: '',
    WordType: 0,
    AIFallback: { CanUse: true, Auto: false },
  }
  deps.get.mockResolvedValue({ success: true, ecp: miss })
  expect(await runDictionaryLookup('zorbly', { counts: true }, deps)).toEqual(
    expect.objectContaining({ AIFallback: { CanUse: true, Auto: false } })
  )
  expect(deps.record).not.toHaveBeenCalled()
})

it('reports a failed read in place of the definition, with no AI offer to return', async () => {
  const deps = setup()
  deps.get.mockResolvedValue({
    success: false,
    error: 'Dictionary lookup failed',
  })
  expect(
    await runDictionaryLookup('cat', { counts: true }, deps)
  ).toBeUndefined()
  expect(deps.onFailure).toHaveBeenCalledWith({
    success: false,
    error: 'Dictionary lookup failed',
  })
  expect(deps.onDefinition).not.toHaveBeenCalled()
  expect(deps.record).not.toHaveBeenCalled()
})

it('a read-only card shows the carried page state and never records a lookup', async () => {
  const deps = setup()
  await runDictionaryLookup(
    'cat',
    { counts: false, state: { ...word, LoadCount: 19, Known: true } },
    deps
  )
  expect(deps.onDefinition).toHaveBeenCalledWith(
    expect.objectContaining({ LoadCount: 19, Known: true })
  )
  expect(deps.record).not.toHaveBeenCalled()
  expect(deps.onCounted).not.toHaveBeenCalled()
})

it('a read-only card without page state shows no count', async () => {
  const deps = setup()
  deps.get.mockResolvedValue({
    success: true,
    ecp: { ...word, LoadCount: 3, Known: false },
  })
  await runDictionaryLookup('cat', { counts: false }, deps)
  expect(deps.onDefinition).toHaveBeenCalledWith(
    expect.objectContaining({ LoadCount: undefined, Known: undefined })
  )
  expect(deps.record).not.toHaveBeenCalled()
})

it('a replaced popover only updates underlines and the side panel when counting finishes', async () => {
  const deps = setup()
  let current = true
  deps.isCurrent = () => current
  deps.record.mockImplementation(async () => {
    current = false
    return { success: true, queryCount: 8, known: false }
  })
  await runDictionaryLookup('cat', { counts: true }, deps)
  expect(deps.onDefinition).toHaveBeenCalledTimes(1)
  expect(deps.onCounted).toHaveBeenCalledWith(
    expect.objectContaining({ LoadCount: 8 })
  )
})

it('an account change drops the late count entirely', async () => {
  const deps = setup()
  let active = true
  deps.isActive = () => active
  deps.record.mockImplementation(async () => {
    active = false
    return { success: true, queryCount: 8, known: false }
  })
  await runDictionaryLookup('cat', { counts: true }, deps)
  expect(deps.onDefinition).toHaveBeenCalledTimes(1)
  expect(deps.onCounted).not.toHaveBeenCalled()
})

it('reports session loss from the count even when that failure invalidates the account', async () => {
  const deps = setup()
  let active = true
  deps.isActive = () => active
  deps.record.mockImplementation(async () => {
    active = false
    return { success: false, sessionExpired: true }
  })
  await runDictionaryLookup('cat', { counts: true }, deps)
  expect(deps.onRecordFailure).toHaveBeenCalledWith({
    success: false,
    sessionExpired: true,
  })
  expect(deps.onCounted).not.toHaveBeenCalled()
})
