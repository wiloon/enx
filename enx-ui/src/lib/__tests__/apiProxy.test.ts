import { apiProxyUrl, isApiPath } from '../apiProxy'

describe('isApiPath', () => {
  it.each(['/api', '/api/stats/overview', '/api/me'])('matches %s', (p) => {
    expect(isApiPath(p)).toBe(true)
  })
  it.each(['/', '/stats', '/apiary', '/app/api'])('does not match %s', (p) => {
    expect(isApiPath(p)).toBe(false)
  })
})

describe('apiProxyUrl', () => {
  it('joins base, path and query', () => {
    expect(
      apiProxyUrl(
        '/api/stats/overview',
        '?date=2026-09-20',
        'http://enx-api.enx.svc:8091'
      )?.href
    ).toBe('http://enx-api.enx.svc:8091/api/stats/overview?date=2026-09-20')
  })
  it('tolerates a trailing slash on the base', () => {
    expect(apiProxyUrl('/api/me', '', 'http://127.0.0.1:8091/')?.href).toBe(
      'http://127.0.0.1:8091/api/me'
    )
  })
  it('keeps a path prefix on the base', () => {
    expect(apiProxyUrl('/api/me', '', 'https://h.example/gw')?.href).toBe(
      'https://h.example/gw/api/me'
    )
  })
  it.each([undefined, '', '   '])(
    'returns null, with no default, for %p',
    (base) => {
      expect(apiProxyUrl('/api/me', '', base)).toBeNull()
    }
  )
})
