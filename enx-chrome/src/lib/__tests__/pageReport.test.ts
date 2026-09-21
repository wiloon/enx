import { sanitizePageUrl } from '@/lib/pageReport'

// The cases mirror enx-api/pagereport/pagereport_test.go TestSanitizeURL: the
// extension shows the user this URL and the server re-sanitizes it, so the two
// implementations must agree.
describe('sanitizePageUrl', () => {
  const cases: [string, string, string][] = [
    [
      'strips query and fragment',
      'https://x.com/sairahul1/status/2089995692874068433?s=20&t=abc#frag',
      'https://x.com/sairahul1/status/2089995692874068433',
    ],
    [
      'strips credentials',
      'https://user:pass@www.infoq.com/articles/x',
      'https://www.infoq.com/articles/x',
    ],
    [
      'lowercases host',
      'https://WWW.InfoQ.com/Articles/X',
      'https://www.infoq.com/Articles/X',
    ],
    [
      'keeps a 19-digit tweet id',
      'https://x.com/a/status/2089995692874068433',
      'https://x.com/a/status/2089995692874068433',
    ],
    [
      'redacts an email path segment',
      'https://messaging-custom-newsletters.nytimes.com/unsub/jane@example.com/go',
      'https://messaging-custom-newsletters.nytimes.com/unsub/:redacted/go',
    ],
    [
      'redacts a percent-encoded email path segment',
      'https://example.com/unsub/jane%40example.com/go',
      'https://example.com/unsub/:redacted/go',
    ],
    [
      'redacts a long mixed token',
      'https://example.com/r/AbC123dEf456GhI789jKl012/page',
      'https://example.com/r/:redacted/page',
    ],
    [
      'redacts a UUID',
      'https://example.com/r/123e4567-e89b-12d3-a456-426614174000',
      'https://example.com/r/:redacted',
    ],
    [
      'redacts a very long segment',
      `https://example.com/${'a'.repeat(40)}`,
      'https://example.com/:redacted',
    ],
    [
      'keeps a normal slug',
      'https://www.infoq.com/articles/kubernetes-operators-in-practice',
      'https://www.infoq.com/articles/kubernetes-operators-in-practice',
    ],
    ['bare origin', 'https://x.com', 'https://x.com/'],
  ]

  it.each(cases)('%s', (_name, input, expected) => {
    expect(sanitizePageUrl(input)).toBe(expected)
  })

  it('returns null for anything that is not a plain http(s) page', () => {
    for (const input of [
      undefined,
      '',
      'not a url',
      'ftp://example.com/a',
      'javascript:alert(1)',
      'chrome://extensions',
      'file:///etc/passwd',
      `https://example.com/${'a/'.repeat(600)}`,
    ]) {
      expect(sanitizePageUrl(input)).toBeNull()
    }
  })

  it('never lets a query string or fragment through', () => {
    const out = sanitizePageUrl('https://example.com/a?token=SECRET#SECRET2')
    expect(out).not.toMatch(/SECRET|token|\?|#/)
  })
})
