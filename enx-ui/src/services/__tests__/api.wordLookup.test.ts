import { ApiService } from '../api'

describe('ApiService.recordWordLookup', () => {
  beforeEach(() => {
    ;(global.fetch as jest.Mock) = jest.fn()
  })

  it('POSTs the word id to /api/me/word-lookups, without fromCache', async () => {
    const service = new ApiService('http://localhost:8090')
    service.setAccessToken('access-token')
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ queryCount: 4, known: false }),
    })

    const result = await service.recordWordLookup('w1')

    expect(result).toEqual({
      success: true,
      data: { queryCount: 4, known: false },
    })
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toBe('http://localhost:8090/api/me/word-lookups')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ wordId: 'w1' })
  })
})
