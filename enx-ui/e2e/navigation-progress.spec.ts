import { test, expect, type Page } from '@playwright/test'

const bar = (page: Page) => page.getByTestId('navigation-progress')

/** Hold every /pricing request until release() is called. */
async function holdPricing(page: Page) {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  // page.route's predicate receives a URL, not a Route.
  await page.route(
    (url) => url.pathname === '/pricing',
    async (route) => {
      await gate
      await route.continue()
    }
  )
  return { release }
}

async function clickPricing(page: Page) {
  // Prefer the footer next/link so the click is a client navigation (the bar's
  // real target). The header Pricing item is a plain <a> (full document load).
  await page
    .getByRole('contentinfo')
    .getByRole('link', { name: 'Pricing' })
    .click()
}

test.describe('navigation progress bar', () => {
  test('shows a top bar above the header while a slow navigation is pending', async ({
    page,
  }) => {
    const held = await holdPricing(page)
    await page.goto('/')
    const header = page.locator('header').first()
    const headerYBefore = (await header.boundingBox())!.y

    try {
      const navigation = clickPricing(page)

      await expect(bar(page)).toBeVisible({ timeout: 5000 })
      const box = await bar(page).boundingBox()
      expect(box).not.toBeNull()
      expect(box!.y).toBe(0)

      const topmost = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="navigation-progress"]')
        if (!el) return null
        const r = el.getBoundingClientRect()
        const hit = document.elementFromPoint(
          r.left + r.width / 2,
          r.top + Math.min(1, r.height / 2)
        )
        return hit?.closest('[data-testid="navigation-progress"]') != null
      })
      expect(topmost).toBe(true)

      expect((await header.boundingBox())!.y).toBe(headerYBefore)

      held.release()
      await navigation
      await expect(page).toHaveURL(/\/pricing/)
      await expect(bar(page)).toHaveCount(0)
    } finally {
      held.release()
    }
  })

  test('does not flash the bar on a fast navigation', async ({ page }) => {
    await page.goto('/')

    let sawBar = false
    const watch = page.waitForSelector('[data-testid="navigation-progress"]', {
      state: 'visible',
      timeout: 2000,
    })
    watch
      .then(() => {
        sawBar = true
      })
      .catch(() => {})

    await clickPricing(page)
    await expect(page).toHaveURL(/\/pricing/)
    await expect(bar(page)).toHaveCount(0)
    await watch.catch(() => {})
    expect(sawBar).toBe(false)
  })

  test('uses a static bar under prefers-reduced-motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const held = await holdPricing(page)
    await page.goto('/')
    try {
      const navigation = clickPricing(page)

      await expect(bar(page)).toBeVisible({ timeout: 5000 })
      const running = await bar(page).evaluate((el) =>
        el
          .getAnimations({ subtree: true })
          .some((animation) => animation.playState === 'running')
      )
      expect(running).toBe(false)

      held.release()
      await navigation
      await expect(bar(page)).toHaveCount(0)
    } finally {
      held.release()
    }
  })

  test('uses the dark --brand token when .dark is on html', async ({
    page,
  }) => {
    const held = await holdPricing(page)
    await page.goto('/')
    await page.evaluate(() => document.documentElement.classList.add('dark'))
    try {
      const navigation = clickPricing(page)

      await expect(bar(page)).toBeVisible({ timeout: 5000 })
      const matchesBrand = await bar(page).evaluate((el) => {
        const probe = document.createElement('div')
        probe.style.backgroundColor = 'var(--brand)'
        document.body.appendChild(probe)
        const ok =
          getComputedStyle(el).backgroundColor ===
          getComputedStyle(probe).backgroundColor
        probe.remove()
        return ok
      })
      expect(matchesBrand).toBe(true)

      held.release()
      await navigation
      await expect(bar(page)).toHaveCount(0)
    } finally {
      held.release()
    }
  })
})
