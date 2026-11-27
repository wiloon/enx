import { test, expect, type Page } from '@playwright/test'

// ADR-096 in a real browser: the legal pages in both languages under their
// own URLs and <html lang>, the switch, and everything else staying English.

const CHOICE = 'catglish_ui_language'

async function cookieNames(page: Page) {
  return (await page.context().cookies()).map((c) => c.name)
}

for (const path of ['/privacy', '/terms', '/refund']) {
  test(`${path} is English and /zh${path} Chinese, each with its <html lang>`, async ({
    page,
  }) => {
    await page.goto(path)
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(page.locator('footer')).toContainText('Privacy Policy')

    await page.goto(`/zh${path}`)
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh')
    await expect(page.locator('footer')).toContainText('隐私政策')
  })
}

test('/en/privacy redirects to /privacy', async ({ page }) => {
  const response = await page.request.get('/en/privacy', { maxRedirects: 0 })
  expect([307, 308]).toContain(response.status())
  expect(new URL(response.headers()['location'], 'http://x').pathname).toBe(
    '/privacy'
  )

  await page.goto('/en/privacy')
  expect(new URL(page.url()).pathname).toBe('/privacy')
})

test('a browser that asks for Chinese still gets English, with no language redirect', async ({
  browser,
}) => {
  const context = await browser.newContext({ locale: 'zh-CN' })
  const page = await context.newPage()
  const response = await page.goto('/privacy')
  // A fresh browser on a Clerk development instance may take Clerk's
  // handshake round trip first; what must not appear is a language prefix.
  const chain: string[] = []
  for (let r = response!.request(); r; r = r.redirectedFrom()!) {
    chain.push(new URL(r.url()).pathname)
    if (!r.redirectedFrom()) break
  }
  expect(chain.filter((p) => /^\/(zh|en)(\/|$)/.test(p))).toEqual([])
  expect(new URL(page.url()).pathname).toBe('/privacy')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await context.close()
})

test('opening /zh/privacy sets no language cookie', async ({ page }) => {
  await page.goto('/zh/privacy')
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh')
  const names = await cookieNames(page)
  expect(names).not.toContain(CHOICE)
  expect(names).not.toContain('NEXT_LOCALE')
})

test('the header switch takes /privacy to /zh/privacy and back, recording the choice', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/privacy')
  await page
    .getByRole('banner')
    .getByRole('button', { name: '简体中文' })
    .click()
  await expect(page).toHaveURL(/\/zh\/privacy$/)
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh')
  await expect(
    page.getByRole('navigation', { name: '主导航' }).getByRole('link', {
      name: '帮助',
    })
  ).toBeVisible()
  expect(
    (await page.context().cookies()).find((c) => c.name === CHOICE)?.value
  ).toBe('zh')

  await page
    .getByRole('banner')
    .getByRole('button', { name: 'English' })
    .click()
  await expect(page).toHaveURL(/\/privacy$/)
  await expect(page).not.toHaveURL(/\/zh\//)
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  expect(
    (await page.context().cookies()).find((c) => c.name === CHOICE)?.value
  ).toBe('en')
})

test('the mobile menu switch takes /terms to /zh/terms', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 })
  await page.goto('/terms')
  await page.getByRole('button', { name: 'Open menu' }).click()
  await page
    .getByRole('navigation', { name: 'Menu' })
    .getByRole('button', { name: '简体中文' })
    .click()
  await expect(page).toHaveURL(/\/zh\/terms$/)
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh')
  await expect(page.getByRole('button', { name: '打开菜单' })).toBeVisible()
})

test('with the choice set to Chinese, /pricing is still English', async ({
  page,
  baseURL,
}) => {
  await page
    .context()
    .addCookies([{ name: CHOICE, value: 'zh', url: baseURL! }])
  await page.goto('/pricing')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(
    page.getByRole('banner').getByRole('link', { name: 'Sign in' })
  ).toBeVisible()
  await expect(page.locator('footer')).toContainText('Privacy Policy')
})

for (const path of ['/zh/pricing', '/en/pricing']) {
  test(`${path} is not a page`, async ({ page }) => {
    const response = await page.goto(path)
    expect(response!.status()).toBe(404)
  })
}
