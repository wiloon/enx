import { browserName } from '../browserName'

// enx-ui's browser helper takes the same cases: both clients send the
// browser as "Name Major", which enx-api checks, never the raw user-agent.
describe('browserName', () => {
  const ua = {
    chrome:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
    edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.3595.65',
    opera:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 OPR/125.0.0.0',
    firefox:
      'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0',
    safari:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  }

  it.each([
    ['Chrome', ua.chrome, 'Chrome 142'],
    ['Edge', ua.edge, 'Edge 142'],
    ['Opera', ua.opera, 'Opera 125'],
    ['Firefox', ua.firefox, 'Firefox 133'],
    ['Safari', ua.safari, 'Safari 18'],
    ['an unknown browser', 'curl/8.0', ''],
  ])('reads %s from the user-agent', (_name, userAgent, expected) => {
    expect(browserName({ userAgent })).toBe(expected)
  })

  it('prefers the named brand from userAgentData over the user-agent', () => {
    expect(
      browserName({
        userAgent: ua.chrome,
        userAgentData: {
          brands: [
            { brand: 'Not_A Brand', version: '99' },
            { brand: 'Chromium', version: '143' },
            { brand: 'Microsoft Edge', version: '143' },
          ],
        },
      })
    ).toBe('Edge 143')
  })

  it('names Google Chrome as Chrome', () => {
    expect(
      browserName({
        userAgent: '',
        userAgentData: {
          brands: [
            { brand: 'Google Chrome', version: '142' },
            { brand: 'Chromium', version: '142' },
            { brand: 'Not?A_Brand', version: '24' },
          ],
        },
      })
    ).toBe('Chrome 142')
  })

  it('falls back to Chromium when no other brand is named', () => {
    expect(
      browserName({
        userAgent: '',
        userAgentData: {
          brands: [
            { brand: 'Chromium', version: '142' },
            { brand: 'Not A(Brand', version: '8' },
          ],
        },
      })
    ).toBe('Chromium 142')
  })
})
