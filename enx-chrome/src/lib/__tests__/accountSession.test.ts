import {
  createAccountSession,
  type Invalidation,
} from '@/lib/accountSession'

function setup(saved: string | null = 'user-a') {
  const invalidations: Invalidation[] = []
  const session = createAccountSession({
    readOwner: async () => saved,
    writeOwner: async () => {},
    invalidate: async cause => {
      invalidations.push(cause)
    },
  })
  return { session, invalidations }
}

describe('createAccountSession invalidation cause (#236)', () => {
  it('reports a confirmed 401 as expired, and a request it fenced lost its session', async () => {
    const { session, invalidations } = setup()
    const isCurrent = session.capture()

    await session.clear('expired')

    expect(invalidations).toEqual(['expired'])
    expect(isCurrent()).toBe(false)
    expect(session.sessionLost()).toBe(true)
  })

  it('reports a signed-in user observed as signed out as lost', async () => {
    const { session, invalidations } = setup()

    await session.observe(null)

    expect(invalidations).toEqual(['lost'])
    expect(session.sessionLost()).toBe(true)
  })

  it('reports a switch to another signed-in account as switched, which is no session loss', async () => {
    const { session, invalidations } = setup()

    await session.observe('user-b')

    expect(invalidations).toEqual(['switched'])
    expect(session.sessionLost()).toBe(false)
  })

  it('records the cause as soon as a 401 fences, before the queued owner update runs', () => {
    const { session } = setup()
    const isCurrent = session.capture()

    void session.clear('expired')

    expect(isCurrent()).toBe(false)
    expect(session.sessionLost()).toBe(true)
  })

  it('lets a later sign-in supersede an earlier session loss', async () => {
    const { session, invalidations } = setup()
    await session.observe(null)

    await session.observe('user-b')

    expect(invalidations).toEqual(['lost', 'switched'])
    expect(session.sessionLost()).toBe(false)
  })
})
