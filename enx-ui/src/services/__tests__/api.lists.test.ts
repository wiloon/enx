import { ApiService } from '../api'

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, statusText: 'OK', json: async () => body }
}

describe('ApiService word list and saved pages', () => {
  let service: ApiService

  beforeEach(() => {
    jest.resetAllMocks()
    service = new ApiService('http://localhost:8090')
    service.setAccessToken('access-token')
    ;(global.fetch as jest.Mock) = jest
      .fn()
      .mockResolvedValue(
        jsonResponse({ success: true, total: 0, words: [], pages: [] })
      )
  })

  const calledUrl = () => (global.fetch as jest.Mock).mock.calls[0][0]

  it('GETs /api/me/words with the filter, search and paging', async () => {
    await service.listMyWords({
      status: 'known',
      sort: 'lookups',
      q: 'eph',
      limit: 50,
      offset: 100,
    })
    expect(calledUrl()).toBe(
      'http://localhost:8090/api/me/words?status=known&sort=lookups&q=eph&limit=50&offset=100'
    )
  })

  it('PUTs /api/me/words/:english/known to mark a word known, encoded', async () => {
    await service.setWordKnown("o'clock/x", true)
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toBe("http://localhost:8090/api/me/words/o'clock%2Fx/known")
    expect(init.method).toBe('PUT')
  })

  it('DELETEs /api/me/words/:english/known to mark a word learning again', async () => {
    await service.setWordKnown('ephemeral', false)
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toBe('http://localhost:8090/api/me/words/ephemeral/known')
    expect(init.method).toBe('DELETE')
  })

  it('leaves out the optional word-list parameters it was not given', async () => {
    await service.listMyWords({ status: 'all' })
    expect(calledUrl()).toBe('http://localhost:8090/api/me/words?status=all')
  })

  it('DELETEs one word from the word list, encoded', async () => {
    await service.removeMyWord("o'clock/x")
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toBe("http://localhost:8090/api/me/words/o'clock%2Fx")
    expect(init.method).toBe('DELETE')
  })

  it('GETs /api/saved-pages', async () => {
    await service.listSavedPages()
    expect(calledUrl()).toBe('http://localhost:8090/api/saved-pages')
  })

  it('DELETEs one saved page by id', async () => {
    await service.deleteSavedPage('a/b')
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toBe('http://localhost:8090/api/saved-pages/a%2Fb')
    expect(init.method).toBe('DELETE')
  })
})
