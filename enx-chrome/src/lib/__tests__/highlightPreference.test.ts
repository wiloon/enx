import { createHighlightPreference } from '@/lib/highlightPreference'

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => {
    resolve = r
  })
  return { promise, resolve }
}

// A page with the blocks of one processing run at a time and at most one
// paint window, over the blocks that were current when it started.
const fakePage = (blocks: string) => {
  const page = {
    blocks,
    window: null as string | null,
    paint: {
      start: () => {
        page.window = page.blocks
      },
      stop: () => {
        page.window = null
      },
    },
  }
  return page
}

describe('createHighlightPreference', () => {
  describe('a flip while the run reads the preference', () => {
    it('on to off: the run ends with no paint window', async () => {
      const page = fakePage('previous run')
      page.window = 'previous run'
      const read = deferred<boolean>()
      const preference = createHighlightPreference({
        read: () => read.promise,
        paint: page.paint,
      })

      const loading = preference.load()
      preference.changed(false)
      read.resolve(true)
      await loading
      page.blocks = 'this run'
      const painted = preference.paintRun()

      expect(painted).toBe(false)
      expect(page.window).toBeNull()
    })

    it('off to on: the run ends with a paint window over its own blocks', async () => {
      const page = fakePage('previous run')
      const read = deferred<boolean>()
      const preference = createHighlightPreference({
        read: () => read.promise,
        paint: page.paint,
      })

      const loading = preference.load()
      preference.changed(true)
      expect(page.window).toBe('previous run')
      read.resolve(false)
      await loading
      page.blocks = 'this run'
      const painted = preference.paintRun()

      expect(painted).toBe(true)
      expect(page.window).toBe('this run')
    })
  })

  describe('with no flip during the read', () => {
    it.each([true, false])(
      'the run follows the stored value (%s)',
      async stored => {
        const page = fakePage('this run')
        const preference = createHighlightPreference({
          read: async () => stored,
          paint: page.paint,
        })

        await preference.load()
        const painted = preference.paintRun()

        expect(painted).toBe(stored)
        expect(page.window).toBe(stored ? 'this run' : null)
      }
    )

    it('a later run follows a stored value that changed since the last flip', async () => {
      const page = fakePage('this run')
      let stored = false
      const preference = createHighlightPreference({
        read: async () => stored,
        paint: page.paint,
      })
      preference.changed(false)
      stored = true

      await preference.load()
      preference.paintRun()

      expect(page.window).toBe('this run')
    })
  })

  describe('a flip with no run in flight', () => {
    it('off clears the paint window at once', async () => {
      const page = fakePage('this run')
      const preference = createHighlightPreference({
        read: async () => true,
        paint: page.paint,
      })
      await preference.load()
      preference.paintRun()

      preference.changed(false)

      expect(page.window).toBeNull()
    })

    it('on repaints over the current blocks at once', async () => {
      const page = fakePage('this run')
      const preference = createHighlightPreference({
        read: async () => false,
        paint: page.paint,
      })
      await preference.load()
      preference.paintRun()

      preference.changed(true)

      expect(page.window).toBe('this run')
    })
  })
})
