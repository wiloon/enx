import { createArticleChoice } from '../articleChoice'

it('a saved unique choice overrides automatic detection', async () => {
  const choice = createArticleChoice<string>({
    read: async () => '#story',
    write: async () => {},
    resolve: selector => (selector === '#story' ? ['chosen'] : []),
    selectorFor: () => '#story',
    isEligible: () => true,
  })
  await choice.load()
  expect(choice.current()).toEqual({
    node: 'chosen',
    source: 'your-choice',
    saved: true,
    missed: false,
  })
})

it('a page-only choice replaces the old saved selector and disappears on reload', async () => {
  let stored: string | null = '#old'
  const deps = {
    read: async () => stored,
    write: async (value: string | null) => {
      stored = value
    },
    resolve: () => ['old'],
    selectorFor: () => null,
    isEligible: () => true,
  }
  const choice = createArticleChoice<string>(deps)
  await choice.load()
  await choice.confirm('new')
  expect(choice.current()).toEqual({
    node: 'new',
    source: 'your-choice',
    saved: false,
    missed: false,
  })
  const reloaded = createArticleChoice<string>(deps)
  await reloaded.load()
  expect(reloaded.current()).toEqual({
    source: 'automatic',
    saved: false,
    missed: false,
  })
})

it('Use automatic clears both the current node and the remembered choice', async () => {
  let stored: string | null = '#story'
  const choice = createArticleChoice<string>({
    read: async () => stored,
    write: async value => {
      stored = value
    },
    resolve: () => ['story'],
    selectorFor: () => '#story',
    isEligible: () => true,
  })
  await choice.load()
  await choice.confirm('story')
  await choice.useAutomatic()
  expect(choice.current()).toEqual({
    source: 'automatic',
    saved: false,
    missed: false,
  })
  expect(stored).toBeNull()
})

it.each([[], ['one', 'two'], ['body']])(
  'an invalid saved match falls through without deleting the rule: %j',
  async (...nodes) => {
    const write = jest.fn()
    const choice = createArticleChoice<string>({
      read: async () => '#story',
      write,
      resolve: () => nodes,
      selectorFor: () => null,
      isEligible: node => node !== 'body',
    })
    await choice.load()
    expect(choice.current()).toEqual({
      source: 'automatic',
      saved: true,
      missed: true,
    })
    expect(write).not.toHaveBeenCalled()
  }
)

it.each([false, true])(
  'picking pauses learning mode and cancel restores its original state (%s)',
  async wasOn => {
    const { createArticlePickSession } = await import('../articleChoice')
    let on = wasOn
    const mode = {
      isOn: () => on,
      stop: () => {
        on = false
      },
      enable: async () => {
        on = true
      },
    }
    const session = createArticlePickSession({
      mode,
      confirm: async () => {},
      useAutomatic: async () => {},
    })
    session.begin()
    expect(on).toBe(false)
    await session.cancel()
    expect(on).toBe(wasOn)
  }
)

it.each([false, true])(
  'confirmation enables the new area from initial state %s',
  async wasOn => {
    const { createArticlePickSession } = await import('../articleChoice')
    let on = wasOn
    let area = 'old'
    const enabledAreas: string[] = []
    const session = createArticlePickSession<string>({
      mode: {
        isOn: () => on,
        stop: () => {
          on = false
        },
        enable: async () => {
          enabledAreas.push(area)
          on = true
        },
      },
      confirm: async node => {
        area = node
      },
      useAutomatic: async () => {},
    })
    session.begin()
    await session.confirm('new')
    expect(on).toBe(true)
    expect(enabledAreas).toEqual(['new'])
  }
)

it.each([false, true])(
  'Use automatic recalculates only if learning mode was on (%s)',
  async wasOn => {
    const { createArticlePickSession } = await import('../articleChoice')
    let on = wasOn
    let area = 'chosen'
    const enabledAreas: string[] = []
    const session = createArticlePickSession<string>({
      mode: {
        isOn: () => on,
        stop: () => {
          on = false
        },
        enable: async () => {
          enabledAreas.push(area)
          on = true
        },
      },
      confirm: async () => {},
      useAutomatic: async () => {
        area = 'automatic'
      },
    })
    await session.useAutomatic()
    expect(area).toBe('automatic')
    expect(on).toBe(wasOn)
    expect(enabledAreas).toEqual(wasOn ? ['automatic'] : [])
  }
)

it('a session loss during persistence prevents a pending confirmation from restarting learning mode', async () => {
  const { createArticlePickSession } = await import('../articleChoice')
  let complete!: () => void
  const enable = jest.fn()
  const session = createArticlePickSession<string>({
    mode: { isOn: () => true, stop: () => {}, enable },
    confirm: () =>
      new Promise<void>(resolve => {
        complete = resolve
      }),
    useAutomatic: async () => {},
  })
  session.begin()
  const pending = session.confirm('new')
  session.abandon()
  complete()
  await pending
  expect(enable).not.toHaveBeenCalled()
})
