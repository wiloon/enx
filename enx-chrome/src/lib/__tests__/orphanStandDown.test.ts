import { STAND_DOWN_EVENT, listenForStandDown } from '@/lib/orphanStandDown'

describe('listenForStandDown (#561)', () => {
  let runtimeId: string | undefined
  let target: EventTarget
  let onStandDown: jest.Mock

  const setup = () =>
    listenForStandDown({
      target,
      runtimeId: () => runtimeId,
      onStandDown,
    })

  beforeEach(() => {
    runtimeId = 'live-extension-id'
    target = new EventTarget()
    onStandDown = jest.fn()
  })

  it('stands down once the runtime has lost its id', () => {
    const standDown = setup()
    runtimeId = undefined

    target.dispatchEvent(new Event(STAND_DOWN_EVENT))

    expect(onStandDown).toHaveBeenCalledTimes(1)
    expect(standDown.isStoodDown()).toBe(true)
  })

  it('a live script ignores the event, its own or a forged one', () => {
    const standDown = setup()

    standDown.announce()
    target.dispatchEvent(new Event(STAND_DOWN_EVENT))

    expect(onStandDown).not.toHaveBeenCalled()
    expect(standDown.isStoodDown()).toBe(false)
  })

  it('announce dispatches the event other scripts listen for', () => {
    const heard = jest.fn()
    target.addEventListener(STAND_DOWN_EVENT, heard)

    setup().announce()

    expect(heard).toHaveBeenCalledTimes(1)
  })

  it('is marked stood down before the teardown runs', () => {
    const standDown = setup()
    let stoodDownDuringTeardown: boolean | undefined
    onStandDown.mockImplementation(() => {
      stoodDownDuringTeardown = standDown.isStoodDown()
    })
    runtimeId = undefined

    target.dispatchEvent(new Event(STAND_DOWN_EVENT))

    expect(onStandDown).toHaveBeenCalledTimes(1)
    expect(stoodDownDuringTeardown).toBe(true)
  })

  it('stands down only once, however many scripts announce', () => {
    setup()
    runtimeId = undefined

    target.dispatchEvent(new Event(STAND_DOWN_EVENT))
    target.dispatchEvent(new Event(STAND_DOWN_EVENT))

    expect(onStandDown).toHaveBeenCalledTimes(1)
  })

  it('tolerates a runtime getter that throws', () => {
    const standDown = listenForStandDown({
      target,
      runtimeId: () => {
        throw new Error('Extension context invalidated.')
      },
      onStandDown,
    })

    target.dispatchEvent(new Event(STAND_DOWN_EVENT))

    expect(standDown.isStoodDown()).toBe(true)
    expect(onStandDown).toHaveBeenCalledTimes(1)
  })
})
