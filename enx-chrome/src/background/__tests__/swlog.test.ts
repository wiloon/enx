import { heartbeat, readSwLog, recordWorkerBoot, swlog } from '../swlog'

// Minimal in-memory chrome.storage stand-in so the ring buffer round-trips.
function installStorage(initial: Record<string, unknown> = {}) {
  const local: Record<string, unknown> = { ...initial }
  const session: Record<string, unknown> = {}
  ;(chrome.storage.local.get as jest.Mock).mockImplementation(async (key: string) => ({
    [key]: local[key],
  }))
  ;(chrome.storage.local.set as jest.Mock).mockImplementation(async (obj: object) => {
    Object.assign(local, obj)
  })
  ;(chrome.storage.session.get as jest.Mock).mockImplementation(async (key: string) => ({
    [key]: session[key],
  }))
  ;(chrome.storage.session.set as jest.Mock).mockImplementation(async (obj: object) => {
    Object.assign(session, obj)
  })
  return { local, session }
}

describe('swlog ring buffer', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    jest.spyOn(console, 'log').mockImplementation(() => {})
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('persists entries to chrome.storage.local so they survive worker eviction', async () => {
    installStorage()

    swlog('first')
    swlog('second', 'warn')
    // swlog serialises its writes internally; let them drain.
    await new Promise(resolve => setTimeout(resolve, 0))

    const log = await readSwLog()
    expect(log.map(e => e.msg)).toEqual(['first', 'second'])
    expect(log[1].level).toBe('warn')
    expect(typeof log[0].sinceBootMs).toBe('number')
  })

  it('recordWorkerBoot reports downtime from the last persisted heartbeat', async () => {
    const { session } = installStorage()
    session.enxSwLastAliveAt = Date.now() - 42_000

    await recordWorkerBoot()
    await new Promise(resolve => setTimeout(resolve, 0))

    const log = await readSwLog()
    expect(log[0].msg).toMatch(/worker boot .* had been idle\/dead ~42s/)
    // heartbeat re-stamped on boot
    expect(session.enxSwLastAliveAt).toBeGreaterThan(Date.now() - 5_000)
  })

  it('never throws when storage is unavailable', async () => {
    ;(chrome.storage.local.get as jest.Mock).mockRejectedValue(new Error('no storage'))
    ;(chrome.storage.local.set as jest.Mock).mockRejectedValue(new Error('no storage'))
    ;(chrome.storage.session.set as jest.Mock).mockRejectedValue(new Error('no storage'))

    expect(() => swlog('still fine')).not.toThrow()
    await expect(heartbeat()).resolves.toBeUndefined()
    await expect(readSwLog()).resolves.toEqual([])
  })
})
