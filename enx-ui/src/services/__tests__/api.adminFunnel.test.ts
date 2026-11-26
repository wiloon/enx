import { ApiService } from '../api'

describe('ApiService admin funnel', () => {
  it('GETs the funnel as the signed-in admin', async () => {
    const service = new ApiService('http://localhost:8090')
    service.setAccessToken('access-token')
    const body = { success: true, cohorts: [] }
    ;(global.fetch as jest.Mock) = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => body,
    })

    const resp = await service.adminGetFunnel()

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toBe('http://localhost:8090/api/admin/funnel')
    expect(init.headers.Authorization).toBe('Bearer access-token')
    expect(resp.data).toEqual(body)
  })
})
