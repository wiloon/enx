import { ApiService } from '../api'

const reply = (status: number) => ({
  ok: status === 200,
  status,
  json: async () =>
    status === 200
      ? [{ Word: 'run', Status: 'found' }]
      : { message: 'Refused' },
})
beforeEach(() => {
  global.fetch = jest.fn()
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())
it.each([200, 400, 405, 415, 501, 'network', 401, 429, 500])(
  'reads definitions through the authenticated transport (%s)',
  async (status) => {
    const service = new ApiService()
    service.setAccessToken('token')
    const fetchMock = global.fetch as jest.Mock
    if (status === 'network')
      fetchMock.mockRejectedValueOnce(new TypeError('network'))
    else fetchMock.mockResolvedValueOnce(reply(status as number))
    fetchMock.mockResolvedValue(reply(200))
    const result = await service.dictionaryEntries('run')
    const fallback = [400, 405, 415, 501, 'network'].includes(status)
    expect(fetchMock).toHaveBeenCalledTimes(fallback ? 2 : 1)
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/dictionary/entries',
      expect.objectContaining({
        method: 'QUERY',
        body: '{"words":["run"]}',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer token',
          'X-Enx-Tz-Offset': expect.any(String),
        }),
      })
    )
    if (fallback)
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        '/api/dictionary/entries/query',
        expect.objectContaining({ method: 'POST', body: '{"words":["run"]}' })
      )
    expect(result.success).toBe(status === 200 || fallback)
  }
)
