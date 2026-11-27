import { createStore } from 'jotai'
import {
  ANONYMOUS_NOT_FOUND_MESSAGE,
  ANONYMOUS_SAVE_PROMPT,
  lookUpAnonymously,
  showAnonymousLookup,
} from '@/lib/anonymousLookup'
import {
  anonymousNoticeAtom,
  currentWordAtom,
  errorAtom,
  isTranslatingAtom,
  signedOutAtom,
} from '@/store/atoms'

const DEVICE_ID = '3b241101-e2bb-4255-8caf-4136c566a962'
const LIMIT_MESSAGE =
  "You've reached today's limit for lookups without an account. Sign in to keep going."

const respond = (status: number, body: unknown) =>
  jest.fn(async () => ({
    ok: status < 400,
    status,
    json: async () => body,
  })) as unknown as jest.Mock & typeof fetch

const deps = (fetch: typeof globalThis.fetch) => ({
  fetch,
  apiBaseUrl: 'https://api.test',
  deviceId: async () => DEVICE_ID,
})

describe('lookUpAnonymously (ADR-095 Decision 7)', () => {
  it('posts the word with the device id and no Authorization', async () => {
    const fetch = respond(200, { Word: 'fox', Status: 'found', Chinese: '狐狸' })

    await lookUpAnonymously(' fox ', deps(fetch))

    expect(fetch).toHaveBeenCalledWith(
      'https://api.test/api/anonymous/dictionary/entry',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Enx-Device-Id': DEVICE_ID,
        },
        body: JSON.stringify({ word: 'fox' }),
      }
    )
  })

  it('answers a found entry as a definition with no id, count or known state', async () => {
    const fetch = respond(200, {
      Word: 'fox',
      Status: 'found',
      Id: 'w-fox',
      English: 'fox',
      Pronunciation: 'fɒks',
      Chinese: 'n. 狐狸',
    })

    const result = await lookUpAnonymously('fox', deps(fetch))

    expect(result).toEqual({
      outcome: 'found',
      ecp: {
        Key: 'fox',
        English: 'fox',
        Pronunciation: 'fɒks',
        Chinese: 'n. 狐狸',
        WordType: 0,
      },
    })
  })

  it('answers not_found as not-found', async () => {
    const fetch = respond(200, { Word: 'zzq', Status: 'not_found' })

    expect(await lookUpAnonymously('zzq', deps(fetch))).toEqual({
      outcome: 'not-found',
    })
  })

  it("answers the daily limit with the server's message", async () => {
    const fetch = respond(429, {
      success: false,
      code: 'anonymous_lookup_limit_exceeded',
      message: LIMIT_MESSAGE,
    })

    expect(await lookUpAnonymously('fox', deps(fetch))).toEqual({
      outcome: 'limit-reached',
      message: LIMIT_MESSAGE,
    })
  })

  it('answers 403 as switched off', async () => {
    const fetch = respond(403, { code: 'anonymous_lookup_disabled' })

    expect(await lookUpAnonymously('fox', deps(fetch))).toEqual({
      outcome: 'switched-off',
    })
  })

  it('answers the request rate limit and other failures as failed', async () => {
    expect(
      await lookUpAnonymously(
        'fox',
        deps(respond(429, { code: 'too_many_requests', message: 'Slow down.' }))
      )
    ).toEqual({ outcome: 'failed', error: 'Slow down.' })
    expect(
      await lookUpAnonymously('fox', deps(respond(500, {})))
    ).toMatchObject({ outcome: 'failed' })
    const offline = jest.fn(async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch
    expect(await lookUpAnonymously('fox', deps(offline))).toMatchObject({
      outcome: 'failed',
    })
  })
})

describe('showAnonymousLookup', () => {
  const ecp = {
    Key: 'fox',
    English: 'fox',
    Pronunciation: '',
    Chinese: '狐狸',
    WordType: 0,
  }

  it('shows the definition with the sign-in line', () => {
    const store = createStore()
    store.set(isTranslatingAtom, true)

    showAnonymousLookup(store, { outcome: 'found', ecp })

    expect(store.get(currentWordAtom)).toEqual(ecp)
    expect(store.get(isTranslatingAtom)).toBe(false)
    expect(store.get(anonymousNoticeAtom)).toBe(ANONYMOUS_SAVE_PROMPT)
  })

  it('shows not-found with Sign in in place of a definition', () => {
    const store = createStore()

    showAnonymousLookup(store, { outcome: 'not-found' })

    expect(store.get(currentWordAtom)).toBeNull()
    expect(store.get(anonymousNoticeAtom)).toBe(ANONYMOUS_NOT_FOUND_MESSAGE)
  })

  it("shows the limit's own message with Sign in", () => {
    const store = createStore()

    showAnonymousLookup(store, { outcome: 'limit-reached', message: 'Limit.' })

    expect(store.get(currentWordAtom)).toBeNull()
    expect(store.get(anonymousNoticeAtom)).toBe('Limit.')
  })

  it('shows the normal signed-out prompt when switched off', () => {
    const store = createStore()

    showAnonymousLookup(store, { outcome: 'switched-off' })

    expect(store.get(signedOutAtom)).toBe(true)
    expect(store.get(anonymousNoticeAtom)).toBeNull()
  })

  it('shows a failure as the error', () => {
    const store = createStore()

    showAnonymousLookup(store, { outcome: 'failed', error: 'Down.' })

    expect(store.get(errorAtom)).toBe('Down.')
    expect(store.get(isTranslatingAtom)).toBe(false)
  })
})
