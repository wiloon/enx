import { test, expect } from '@playwright/test'

const guides = [
  { path: '/help', title: 'Help' },
  { path: '/help/install', title: 'Install from the Chrome Web Store' },
  { path: '/help/install/offline', title: 'Install manually from a ZIP file' },
  { path: '/help/get-started', title: 'Get started with Catglish' },
]

for (const theme of ['light', 'dark'] as const) {
  for (const width of [375, 768, 1440]) {
    test(`public help is readable at ${width}px in ${theme} mode`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.addInitScript((dark) => {
        if (dark)
          document.addEventListener('DOMContentLoaded', () =>
            document.documentElement.classList.add('dark')
          )
      }, theme === 'dark')
      for (const guide of guides) {
        await page.goto(guide.path)
        await expect(
          page.getByRole('heading', {
            level: 1,
            name: guide.title,
            exact: true,
          })
        ).toBeVisible()
        await expect(
          page.getByRole('navigation', { name: 'Help guides' })
        ).toBeVisible()
        await expect(
          page
            .getByRole('banner')
            .getByRole('link', { name: 'Help', exact: true })
        ).toBeVisible()
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth
          )
        ).toBe(true)
        await expect(page.locator('img[src^="/help/"]')).toHaveCount(0)
        await page.screenshot({
          path: `test-results/help-${guide.path.replaceAll('/', '-')}-${width}-${theme}.png`,
          animations: 'disabled',
          fullPage: true,
        })
      }
    })
  }
}

test('the public guide links connect the two install paths and setup', async ({
  page,
}) => {
  await page.goto('/help')
  await page
    .getByRole('main')
    .getByRole('link', {
      name: 'Install from the Chrome Web Store',
      exact: true,
    })
    .click()
  await expect(page).toHaveURL(/\/help\/install$/)
  await page
    .getByRole('main')
    .getByRole('link', {
      name: 'Install manually from a ZIP file',
      exact: true,
    })
    .click()
  await expect(page).toHaveURL(/\/help\/install\/offline$/)
  await page
    .getByRole('main')
    .getByRole('link', { name: 'Read the getting-started guide' })
    .click()
  await expect(page).toHaveURL(/\/help\/get-started$/)
  await page.getByRole('link', { name: 'Open Welcome' }).click()
  await expect(page).toHaveURL(/\/welcome$/)
  const install = page.getByRole('link', { name: 'Add to Chrome', exact: true })
  await expect(install).toBeVisible()
  await expect(page.getByText(/With Enhanced protection enabled/)).toBeVisible()
  const offline = page.getByRole('link', {
    name: 'Install manually from a ZIP file',
  })
  await expect(offline).toBeVisible()
  await expect(offline).toHaveAttribute('target', '_blank')
})
