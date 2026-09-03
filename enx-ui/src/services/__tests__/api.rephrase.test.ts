jest.mock('@/lib/cognito', () => ({
  refreshCognitoTokens: jest.fn(),
}))

import { ApiService } from '../api'

function jsonResponse(status: number, body: unknown, ok = status < 400) {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: async () => body,
  }
}

describe('ApiService.rephrase', () => {
  let service: ApiService

  beforeEach(() => {
    jest.resetAllMocks()
    service = new ApiService('http://localhost:8090')
    service.setAccessToken('access-token')
    ;(global.fetch as jest.Mock) = jest.fn()
  })

  it('POSTs the input to /api/rephrase and returns the structured result', async () => {
    const data = {
      idiomatic: 'Could you take a look when you get a chance?',
      alternatives: [{ text: 'Mind taking a look?', register: 'casual' }],
      notes: ['用 when you get a chance 弱化催促。'],
    }
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(jsonResponse(200, data))

    const result = await service.rephrase('帮我看下这个')

    expect(result).toEqual({ success: true, data })
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toBe('http://localhost:8090/api/rephrase')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ input: '帮我看下这个' })
    expect(init.headers.Authorization).toBe('Bearer access-token')
  })

  it('surfaces the backend message on a 402 insufficient-credits response', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse(402, {
        success: false,
        message: 'Insufficient credits. Top up or subscribe to continue.',
      })
    )

    const result = await service.rephrase('帮我看下这个')

    expect(result.success).toBe(false)
    expect(result.error).toBe(
      'Insufficient credits. Top up or subscribe to continue.'
    )
  })

  it('surfaces the backend message on a 502 service-unavailable response', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(
      jsonResponse(502, { success: false, message: 'Rephrase service unavailable.' })
    )

    const result = await service.rephrase('帮我看下这个')

    expect(result.success).toBe(false)
    expect(result.error).toBe('Rephrase service unavailable.')
  })
})
