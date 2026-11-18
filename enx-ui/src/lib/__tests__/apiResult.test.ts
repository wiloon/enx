import { unwrap } from '@/lib/apiResult'

describe('unwrap', () => {
  it('returns the data of a successful response', () => {
    expect(unwrap({ success: true, data: { id: 'a' } }, 'Failed')).toEqual({
      id: 'a',
    })
  })

  it("throws the server's error when the request failed", () => {
    expect(() =>
      unwrap({ success: false, error: 'Quota exceeded' }, 'Failed to load')
    ).toThrow(new Error('Quota exceeded'))
  })

  it('throws the fallback when the failure carries no error', () => {
    expect(() => unwrap({ success: false }, 'Failed to load')).toThrow(
      new Error('Failed to load')
    )
    expect(() =>
      unwrap({ success: false, error: '' }, 'Failed to load')
    ).toThrow(new Error('Failed to load'))
  })

  it('throws for a failure even when it carries data', () => {
    expect(() =>
      unwrap({ success: false, data: { id: 'a' } }, 'Failed to load')
    ).toThrow(new Error('Failed to load'))
  })

  it('treats a success without data as a failure', () => {
    expect(() => unwrap({ success: true }, 'Failed to load')).toThrow(
      new Error('Failed to load')
    )
  })
})
