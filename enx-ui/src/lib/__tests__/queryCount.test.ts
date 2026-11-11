import { recordLookup } from '../queryCount'

it.each([
  [
    { success: true, data: { queryCount: 4, known: false } },
    { LoadCount: 4, Known: false },
  ],
  [
    { success: false, status: 429, error: 'Quota reached' },
    { message: 'Quota reached' },
  ],
  [{ success: false, status: 500, error: 'Server failed' }, {}],
])(
  'records once and returns only authoritative state',
  async (response, expected) => {
    const send = jest.fn().mockResolvedValue(response)
    expect(await recordLookup('w1', send)).toEqual(expected)
    expect(send.mock.calls).toEqual([['w1']])
  }
)
it('silently keeps the definition on network failure without retry', async () => {
  const send = jest.fn().mockRejectedValue(new Error('network'))
  expect(await recordLookup('w1', send)).toEqual({})
  expect(send).toHaveBeenCalledTimes(1)
})
it('does not record a definition without an id', async () => {
  const send = jest.fn()
  expect(await recordLookup('', send)).toEqual({})
  expect(send).not.toHaveBeenCalled()
})
