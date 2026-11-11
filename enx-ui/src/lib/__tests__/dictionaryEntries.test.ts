import { requestDictionaryEntries } from '../dictionaryEntries'

it.each([400, 405, 415, 501, undefined])(
  'falls back once on transport failure %s',
  async (status) => {
    const send = jest.fn().mockResolvedValue({
      success: false,
      status,
      networkError: status === undefined,
    })
    await requestDictionaryEntries(['run'], send)
    expect(send.mock.calls).toEqual([
      ['QUERY', '/api/dictionary/entries', '{"words":["run"]}'],
      ['POST', '/api/dictionary/entries/query', '{"words":["run"]}'],
    ])
  }
)
it.each([200, 401, 429, 500])('does not fall back on %s', async (status) => {
  const result = { success: status === 200, status }
  const send = jest.fn().mockResolvedValue(result)
  expect(await requestDictionaryEntries(['run'], send)).toBe(result)
  expect(send).toHaveBeenCalledTimes(1)
})
