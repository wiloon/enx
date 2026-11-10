import { ApiService } from '../api'

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, statusText: 'OK', json: async () => body }
}

describe('ApiService article choice groups (ADR-073)', () => {
  let service: ApiService

  beforeEach(() => {
    jest.resetAllMocks()
    service = new ApiService('http://localhost:8090')
    service.setAccessToken('access-token')
    ;(global.fetch as jest.Mock) = jest
      .fn()
      .mockResolvedValue(jsonResponse({ success: true }))
  })

  const call = () => (global.fetch as jest.Mock).mock.calls[0]

  it('GETs one page of groups with the status filter', async () => {
    await service.adminListArticleChoiceGroups({
      status: 'new',
      limit: 100,
      offset: 200,
    })
    expect(call()[0]).toBe(
      'http://localhost:8090/api/admin/feedback/article-choices?limit=100&offset=200&status=new'
    )
  })

  it('GETs groups of every status without a status parameter', async () => {
    await service.adminListArticleChoiceGroups({
      status: '',
      limit: 100,
      offset: 0,
    })
    expect(call()[0]).toBe(
      'http://localhost:8090/api/admin/feedback/article-choices?limit=100&offset=0'
    )
  })

  it('POSTs the host and the selector, byte for byte, to resolve a group', async () => {
    await service.adminResolveArticleChoiceGroup(
      'x.com',
      'main > article[data-x="a b"]'
    )
    const [url, init] = call()
    expect(url).toBe(
      'http://localhost:8090/api/admin/feedback/article-choices/resolve'
    )
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({
      host: 'x.com',
      selector: 'main > article[data-x="a b"]',
    })
  })
})
