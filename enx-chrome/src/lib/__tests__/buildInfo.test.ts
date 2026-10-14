import { describeBuild } from '@/lib/buildInfo'

describe('describeBuild', () => {
  it('labels the build with its version', () => {
    expect(describeBuild({ version: '0.1.2.5' }).label).toBe('v0.1.2.5')
  })

  it('spells out version, target, commit and build time in UTC', () => {
    const { details } = describeBuild({
      version: '0.1.2',
      environment: 'production',
      commit: '1a2b3c4',
      builtAt: '2026-10-13T08:05:59.123Z',
    })

    expect(details).toBe(
      [
        'Catglish v0.1.2 (production)',
        'Commit 1a2b3c4',
        'Built 2026-10-13 08:05 UTC',
      ].join('\n')
    )
  })

  it('leaves out what the build did not record', () => {
    expect(describeBuild({ version: '0.0.0' }).details).toBe('Catglish v0.0.0')
  })

  it('leaves out a build time that is not a date', () => {
    expect(
      describeBuild({ version: '0.1.2', builtAt: 'not a date' }).details
    ).toBe('Catglish v0.1.2')
  })
})
