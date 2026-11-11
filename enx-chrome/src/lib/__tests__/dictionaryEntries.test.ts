import {
  definitionFromEntries,
  requestDictionaryEntries,
  type EntriesTransportResult,
} from '@/lib/dictionaryEntries'

const transport = (...results: EntriesTransportResult[]) => {
  const calls: [string, string, string][] = []
  const send = jest.fn(async (method: string, path: string, body: string) => {
    calls.push([method, path, body])
    return results.shift() ?? { success: true, data: [] }
  })
  return { send, calls }
}

describe('requestDictionaryEntries', () => {
  it('sends QUERY with the JSON word list and returns its answer', async () => {
    const { send, calls } = transport({ success: true, data: ['ok'] })
    expect(await requestDictionaryEntries(['cat', 'ran'], send)).toEqual({
      success: true,
      data: ['ok'],
    })
    expect(calls).toEqual([
      ['QUERY', '/api/dictionary/entries', '{"words":["cat","ran"]}'],
    ])
  })

  it.each([400, 405, 415, 501])(
    'retries the same body once with POST after HTTP %i',
    async status => {
      const { send, calls } = transport(
        { success: false, status },
        { success: true, data: ['from post'] }
      )
      expect(await requestDictionaryEntries(['cat'], send)).toEqual({
        success: true,
        data: ['from post'],
      })
      expect(calls).toEqual([
        ['QUERY', '/api/dictionary/entries', '{"words":["cat"]}'],
        ['POST', '/api/dictionary/entries/query', '{"words":["cat"]}'],
      ])
    }
  )

  it('retries with POST after a network error', async () => {
    const { send, calls } = transport(
      { success: false, networkError: true },
      { success: true, data: [] }
    )
    await requestDictionaryEntries(['cat'], send)
    expect(calls.map(([method]) => method)).toEqual(['QUERY', 'POST'])
  })

  it.each([
    { success: false, status: 401, sessionUnverified: true },
    { success: false, status: 429, code: 'lookup_quota_exceeded' },
    { success: false, status: 500 },
    { success: false, status: 503 },
    { success: false, sessionExpired: true },
  ])('does not fall back on %j', async failure => {
    const { send, calls } = transport(failure)
    expect(await requestDictionaryEntries(['cat'], send)).toEqual(failure)
    expect(calls).toHaveLength(1)
  })

  it('falls back at most once even when the POST is refused the same way', async () => {
    const { send, calls } = transport(
      { success: false, status: 405 },
      { success: false, status: 405 }
    )
    expect(await requestDictionaryEntries(['cat'], send)).toEqual({
      success: false,
      status: 405,
    })
    expect(calls).toHaveLength(2)
  })
})

describe('definitionFromEntries', () => {
  it('maps a found entry to the requested click, keyed by its page form', () => {
    expect(
      definitionFromEntries('Cat’s', [
        {
          Word: 'Cat',
          Status: 'found',
          Id: 'cat-id',
          English: 'cat',
          Pronunciation: 'kæt',
          Chinese: '猫',
          WordType: 0,
          Origin: 'ecdict',
        },
      ])
    ).toEqual({
      Id: 'cat-id',
      Key: 'cat',
      English: 'cat',
      Pronunciation: 'kæt',
      Chinese: '猫',
      WordType: 0,
      Origin: 'ecdict',
    })
  })

  it('keeps a found entry without an Id as a definition without one', () => {
    const word = definitionFromEntries('ran', [
      { Word: 'ran', Status: 'found', English: 'run', Chinese: '跑' },
    ])
    expect(word).toMatchObject({ Key: 'ran', English: 'run', Chinese: '跑' })
    expect(word).not.toHaveProperty('Id')
  })

  it('turns not_found into an empty definition of the requested word carrying the AI offer', () => {
    expect(
      definitionFromEntries('Zorbly', [
        {
          Word: 'Zorbly',
          Status: 'not_found',
          AIFallback: { CanUse: true, Auto: false },
        },
      ])
    ).toEqual({
      Key: 'zorbly',
      English: 'Zorbly',
      Pronunciation: '',
      Chinese: '',
      WordType: 0,
      AIFallback: { CanUse: true, Auto: false },
    })
  })

  it.each([
    ['a failed entry', [{ Word: 'cat', Status: 'failed' }]],
    ['an empty array', []],
    ['a non-array body', { English: 'cat' }],
  ])('has no definition for %s', (_name, body) => {
    expect(definitionFromEntries('cat', body)).toBeUndefined()
  })
})
