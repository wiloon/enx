import { test, expect, type Page } from '@playwright/test'

// The marketing header in a real browser: jsdom has no layout, so these pin
// what the unit tests cannot (one row, no overflow, the menu breakpoint).
async function headerFits(page: Page) {
  const header = page.locator('header').first()
  const box = await header.boundingBox()
  // One row: py-3 plus a 32px CTA is 56px; a wrapped row would be ~100px.
  expect(box!.height).toBeLessThanOrEqual(64)
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth
  )
  expect(overflow).toBe(false)
}

for (const width of [1024, 1440]) {
  test(`at ${width}px the header shows the nav in one row, with no menu toggle`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 })
    await page.goto('/')
    const nav = page.getByRole('navigation', { name: 'Main' })
    await expect(nav.getByRole('link', { name: 'Help' })).toBeVisible()
    await expect(
      page.getByRole('banner').getByRole('link', { name: 'GitHub' })
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Open menu' })).toBeHidden()
    await headerFits(page)
  })
}

for (const width of [375, 768]) {
  test(`at ${width}px the section links live in the menu`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await page.goto('/')
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden()
    await headerFits(page)

    await page.getByRole('button', { name: 'Open menu' }).click()
    const menu = page.getByRole('navigation', { name: 'Menu' })
    await expect(menu.getByRole('link', { name: 'Similar apps' })).toBeVisible()
    await menu.getByRole('link', { name: 'Features' }).click()
    await expect(menu).toBeHidden()
    await expect(page).toHaveURL(/#features$/)
  })
}
