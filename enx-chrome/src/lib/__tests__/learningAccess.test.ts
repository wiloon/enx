import {
  ANONYMOUS_DEVICE_ID_KEY,
  EVER_SIGNED_IN_KEY,
  createAnonymousDeviceId,
  createEverSignedIn,
  createLearningAccess,
  learningAccessFor,
  mayTurnOnLearningMode,
  type SessionState,
} from '@/lib/learningAccess'

const memoryStorage = (initial: Record<string, unknown> = {}) => {
  const items: Record<string, unknown> = { ...initial }
  return {
    items,
    get: jest.fn(async (key: string) => items[key]),
    set: jest.fn(async (key: string, value: unknown) => {
      items[key] = value
    }),
  }
}

describe('learningAccessFor (ADR-095 Decision 2)', () => {
  it('is signed-in with a session, flag or not', () => {
    expect(learningAccessFor('present', true)).toBe('signed-in')
    expect(learningAccessFor('present', false)).toBe('signed-in')
  })

  it('is anonymous signed out in a browser that never signed in', () => {
    expect(learningAccessFor('absent', false)).toBe('anonymous')
    expect(learningAccessFor('unknown', false)).toBe('anonymous')
  })

  it('stays signed-out once the browser has signed in before', () => {
    expect(learningAccessFor('absent', true)).toBe('signed-out')
    expect(learningAccessFor('unknown', true)).toBe('signed-out')
  })
})

describe('mayTurnOnLearningMode', () => {
  it('allows signed-in and anonymous, refuses signed-out', () => {
    expect(mayTurnOnLearningMode('signed-in')).toBe(true)
    expect(mayTurnOnLearningMode('anonymous')).toBe(true)
    expect(mayTurnOnLearningMode('signed-out')).toBe(false)
  })
})

describe('createEverSignedIn', () => {
  it('is unset until marked, and marking stores it once', async () => {
    const storage = memoryStorage()
    const flag = createEverSignedIn(storage)

    expect(await flag.isSet()).toBe(false)
    await flag.mark()
    await flag.mark()

    expect(await flag.isSet()).toBe(true)
    expect(storage.items[EVER_SIGNED_IN_KEY]).toBe(true)
    expect(storage.set).toHaveBeenCalledTimes(1)
    // A worker restart reads it back.
    expect(await createEverSignedIn(storage).isSet()).toBe(true)
  })
})

describe('createLearningAccess', () => {
  const setup = (
    session: SessionState,
    { flag = false }: { flag?: boolean } = {}
  ) => {
    const storage = memoryStorage(flag ? { [EVER_SIGNED_IN_KEY]: true } : {})
    let generation = 1
    const sessionState = jest.fn(async (): Promise<SessionState> => session)
    const access = createLearningAccess({
      everSignedIn: createEverSignedIn(storage),
      sessionState,
      generation: () => generation,
    })
    return {
      access,
      sessionState,
      bumpGeneration: () => generation++,
    }
  }

  it('checks the session once per Clerk generation while anonymous', async () => {
    const { access, sessionState, bumpGeneration } = setup('absent')

    expect(await access.current()).toBe('anonymous')
    expect(await access.current()).toBe('anonymous')
    expect(await access.isAnonymous()).toBe(true)
    expect(sessionState).toHaveBeenCalledTimes(1)

    bumpGeneration()
    expect(await access.current()).toBe('anonymous')
    expect(sessionState).toHaveBeenCalledTimes(2)
  })

  it('does not cache a session check that failed', async () => {
    const { access, sessionState } = setup('unknown')

    expect(await access.current()).toBe('anonymous')
    expect(await access.current()).toBe('anonymous')
    expect(sessionState).toHaveBeenCalledTimes(2)
  })

  // An account request then reports the sign-in service unreachable, as
  // today, rather than being refused as anonymous.
  it('is not confirmed anonymous while the session check fails', async () => {
    const { access } = setup('unknown')

    expect(await access.isAnonymous()).toBe(false)
  })

  it('checks every time while signed in', async () => {
    const { access, sessionState } = setup('present')

    expect(await access.current()).toBe('signed-in')
    expect(await access.current()).toBe('signed-in')
    expect(sessionState).toHaveBeenCalledTimes(2)
  })

  it('is signed-out with the flag present, and never anonymous', async () => {
    const { access, sessionState } = setup('absent', { flag: true })

    expect(await access.current()).toBe('signed-out')
    expect(await access.isAnonymous()).toBe(false)
    // isAnonymous needs no session check once the flag is set.
    expect(sessionState).toHaveBeenCalledTimes(1)
  })
})

describe('createAnonymousDeviceId (ADR-095 Decision 4)', () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

  it('creates one random UUID on first need and reuses it', async () => {
    const storage = memoryStorage()
    const deviceId = createAnonymousDeviceId(storage)

    const [first, second] = await Promise.all([deviceId(), deviceId()])
    const third = await deviceId()

    expect(first).toMatch(UUID)
    expect(second).toBe(first)
    expect(third).toBe(first)
    expect(storage.items[ANONYMOUS_DEVICE_ID_KEY]).toBe(first)
    expect(storage.set).toHaveBeenCalledTimes(1)
  })

  it('reads back the stored id after a browser restart', async () => {
    const storage = memoryStorage()
    const before = await createAnonymousDeviceId(storage)()

    expect(await createAnonymousDeviceId(storage)()).toBe(before)
  })

  it('replaces a stored value that is not a UUID', async () => {
    const storage = memoryStorage({ [ANONYMOUS_DEVICE_ID_KEY]: 'nope' })

    expect(await createAnonymousDeviceId(storage)()).toMatch(UUID)
  })
})
