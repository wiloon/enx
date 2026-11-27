import sitemap from '../sitemap'

// ADR-096: each localised page is listed in both languages, and each entry
// names the other as its alternate.
it('lists both language versions of each legal page, linked as alternates', () => {
  const entries = sitemap()
  for (const path of ['/privacy', '/terms', '/refund']) {
    const languages = {
      en: `https://enx.wiloon.lab${path}`,
      zh: `https://enx.wiloon.lab/zh${path}`,
    }
    for (const url of Object.values(languages)) {
      expect(entries).toContainEqual(
        expect.objectContaining({ url, alternates: { languages } })
      )
    }
  }
})

it('lists a page that is not localised once, without a language prefix', () => {
  const urls = sitemap().map((entry) => entry.url)
  expect(urls).toContain('https://enx.wiloon.lab/pricing')
  expect(urls.filter((url) => url.includes('/zh/pricing'))).toEqual([])
})
