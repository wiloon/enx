import {
  findSavedPage,
  forgetSavedPage,
  rememberSavedPage,
  savedPageKey,
  storageKeyFor,
} from '@/lib/savedPagesStore'

// An in-memory chrome.storage.local, so the tests read back what was written.
function useFakeStorage() {
  let data: Record<string, unknown> = {}
  ;(chrome.storage.local.get as jest.Mock).mockImplementation(
    async (key: string) => (key in data ? { [key]: data[key] } : {})
  )
  ;(chrome.storage.local.set as jest.Mock).mockImplementation(
    async (items: Record<string, unknown>) => {
      data = { ...data, ...JSON.parse(JSON.stringify(items)) }
    }
  )
  return () => data
}

describe('savedPageKey', () => {
  it('drops the fragment, credentials and tracking parameters but keeps the rest in order', () => {
    expect(
      savedPageKey(
        'https://user:pw@Example.com/a?utm_source=x&id=7&fbclid=1&page=2#top'
      )
    ).toBe('https://example.com/a?id=7&page=2')
  })

  it('gives the same key to an address with and without tracking parameters', () => {
    expect(savedPageKey('https://example.com/a?gclid=9&mc_cid=1')).toBe(
      savedPageKey('https://example.com/a')
    )
  })

  it('drops X share parameters only on X', () => {
    expect(savedPageKey('https://x.com/u/status/1?s=20&t=abc')).toBe(
      'https://x.com/u/status/1'
    )
    expect(savedPageKey('https://example.com/video?t=90')).toBe(
      'https://example.com/video?t=90'
    )
  })

  it('refuses anything that is not a web page', () => {
    for (const raw of [
      undefined,
      '',
      'not a url',
      'chrome://extensions',
      'file:///tmp/a.html',
    ]) {
      expect(savedPageKey(raw)).toBeNull()
    }
  })
})

describe('saved pages store', () => {
  beforeEach(() => {
    jest.resetAllMocks()
  })

  it('finds a page saved from this browser when the tab is opened again', async () => {
    useFakeStorage()
    await rememberSavedPage('u1', 'https://example.com/a?utm_source=x#top', {
      id: 'p1',
      url: 'https://example.com/a',
    })

    expect(await findSavedPage('u1', 'https://example.com/a#later')).toEqual({
      id: 'p1',
      url: 'https://example.com/a',
    })
  })

  it('matches the tab by its own address even where the stored address differs', async () => {
    useFakeStorage()
    // Whatever enx-api did to the address, the tab the user saved from matches.
    await rememberSavedPage('u1', 'https://example.com/a', {
      id: 'p1',
      url: 'https://example.com/a-canonical',
    })

    expect(await findSavedPage('u1', 'https://example.com/a')).toMatchObject({
      id: 'p1',
    })
  })

  it('does not report pages another account saved', async () => {
    useFakeStorage()
    await rememberSavedPage('u1', 'https://example.com/a', {
      id: 'p1',
      url: 'https://example.com/a',
    })

    expect(await findSavedPage('u2', 'https://example.com/a')).toBeNull()
  })

  it('forgets every entry of a removed page and keeps the others', async () => {
    const data = useFakeStorage()
    await rememberSavedPage('u1', 'https://example.com/a?utm_source=x', {
      id: 'p1',
      url: 'https://example.com/a-canonical',
    })
    await rememberSavedPage('u1', 'https://example.com/b', {
      id: 'p2',
      url: 'https://example.com/b',
    })

    await forgetSavedPage('u1', 'p1')

    expect(await findSavedPage('u1', 'https://example.com/a')).toBeNull()
    expect(await findSavedPage('u1', 'https://example.com/b')).toMatchObject({
      id: 'p2',
    })
    expect(Object.keys(data()[storageKeyFor('u1')] as object)).toEqual([
      'https://example.com/b',
    ])
  })

  it('treats a missing or malformed entry as nothing saved', async () => {
    ;(chrome.storage.local.get as jest.Mock).mockResolvedValue({
      [storageKeyFor('u1')]: 'garbage',
    })

    expect(await findSavedPage('u1', 'https://example.com/a')).toBeNull()
  })
})
