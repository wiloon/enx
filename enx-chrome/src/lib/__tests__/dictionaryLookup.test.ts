import { runDictionaryLookup } from '@/lib/dictionaryLookup'
import type { BackgroundResponse, WordData } from '@/types'

const word: WordData = {
  Id: 'cat-id',
  Key: 'cat',
  English: 'cat',
  Chinese: '猫',
  Pronunciation: 'kæt',
  WordType: 0,
  Known: false,
  LoadCount: 4,
}
const setup = () => ({
  get: jest.fn(async (): Promise<BackgroundResponse> => ({
    success: true,
    fromCache: true,
    ecp: word,
  })),
  record: jest.fn(async (): Promise<BackgroundResponse> => ({
    success: true,
    queryCount: 5,
    known: false,
  })),
  onDefinition: jest.fn(),
  onCounted: jest.fn(),
  onFailure: jest.fn(),
  isActive: () => true,
  isCurrent: () => true,
})

it('shows cached definitions without a count while the one metering POST is pending', async () => {
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
  expect(deps.record).toHaveBeenCalledWith('cat-id', true)
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
])('preserves the definition and reports a refused POST: %j', async failure => {
  const deps = setup()
  deps.record.mockResolvedValue({ success: false, ...failure })
  await runDictionaryLookup('cat', { counts: true }, deps)
  expect(deps.onDefinition).toHaveBeenCalledTimes(1)
  expect(deps.onFailure).toHaveBeenCalledWith({
    success: false,
    ...failure,
    fromCache: true,
  })
  expect(deps.onCounted).not.toHaveBeenCalled()
})

it('recovers a deleted cached id through a fresh metered GET and one unmetered POST', async () => {
  const deps = setup()
  deps.record.mockResolvedValueOnce({ success: false, status: 404 })
  deps.get
    .mockResolvedValueOnce({ success: true, fromCache: true, ecp: word })
    .mockResolvedValueOnce({
      success: true,
      fromCache: false,
      ecp: { ...word, Id: 'new-cat-id', Chinese: '新释义', LoadCount: 0 },
    })
  await runDictionaryLookup('cat', { counts: true }, deps)
  expect(deps.get).toHaveBeenLastCalledWith('cat', true)
  expect(deps.record.mock.calls).toEqual([
    ['cat-id', true],
    ['new-cat-id', false],
  ])
  expect(deps.onCounted).toHaveBeenCalledWith(
    expect.objectContaining({
      Id: 'new-cat-id',
      LoadCount: 5,
      Chinese: '新释义',
    })
  )
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

it('a read-only cache hit shows the carried page count without recording a lookup', async () => {
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

it('a miss counts once optimistically and does not meter again on the POST', async () => {
  const deps = setup()
  deps.get.mockResolvedValue({ success: true, ecp: word, fromCache: false })
  await runDictionaryLookup('cat', { counts: true }, deps)
  expect(deps.record.mock.calls).toEqual([['cat-id', false]])
  expect(deps.onCounted).toHaveBeenCalledWith(
    expect.objectContaining({ LoadCount: 5, Known: false })
  )
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
  expect(deps.onFailure).toHaveBeenCalledWith({
    success: false,
    sessionExpired: true,
    fromCache: true,
  })
  expect(deps.onCounted).not.toHaveBeenCalled()
})
