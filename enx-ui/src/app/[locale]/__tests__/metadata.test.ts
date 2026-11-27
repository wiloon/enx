import * as privacy from '../privacy/page'
import * as terms from '../terms/page'
import * as refund from '../refund/page'
import * as dataSources from '../data-sources/page'

// ADR-096: each language version of a legal page names itself as canonical
// and lists both versions, so search engines treat them as translations.

const params = (locale: string) => ({
  params: Promise.resolve({ locale }),
  searchParams: Promise.resolve({}),
})

describe.each([
  ['/privacy', privacy, /Privacy Policy/, /隐私政策/],
  ['/terms', terms, /Terms of Service/, /用户协议/],
  ['/refund', refund, /Refund Policy/, /退款政策/],
  ['/data-sources', dataSources, /Data sources/, /数据来源/],
])('%s metadata', (path, page, enTitle, zhTitle) => {
  it('is prerendered', () => {
    expect(page.dynamic).toBe('force-static')
  })

  it('is the canonical English version without a prefix', async () => {
    const metadata = await page.generateMetadata(params('en'))

    expect(metadata.title).toMatch(enTitle)
    expect(metadata.alternates).toEqual({
      canonical: path,
      languages: { en: path, zh: `/zh${path}` },
    })
  })

  it('is the canonical Chinese version under /zh', async () => {
    const metadata = await page.generateMetadata(params('zh'))

    expect(metadata.title).toMatch(zhTitle)
    expect(metadata.alternates).toEqual({
      canonical: `/zh${path}`,
      languages: { en: path, zh: `/zh${path}` },
    })
  })
})
