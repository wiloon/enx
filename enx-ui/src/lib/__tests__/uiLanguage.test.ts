import {
  UI_LANGUAGE_CHOICE_COOKIE,
  hrefInUiLanguage,
  isLocalisedPath,
  localisedAlternates,
  uiLanguageChoiceCookie,
  uiLanguageOutsideLocale,
  uiLanguageSwitch,
} from '../uiLanguage'

describe('isLocalisedPath', () => {
  it.each(['/privacy', '/terms', '/refund'])(
    'treats %s as localised, unprefixed or with /zh or /en',
    (path) => {
      expect(isLocalisedPath(path)).toBe(true)
      expect(isLocalisedPath(`/zh${path}`)).toBe(true)
      expect(isLocalisedPath(`/en${path}`)).toBe(true)
    }
  )

  it.each(['/', '/pricing', '/zh/pricing', '/en/pricing', '/app', '/zh'])(
    'does not treat %s as localised',
    (path) => {
      expect(isLocalisedPath(path)).toBe(false)
    }
  )

  it('does not match a path that merely starts like a localised one', () => {
    expect(isLocalisedPath('/privacyx')).toBe(false)
    expect(isLocalisedPath('/fr/privacy')).toBe(false)
  })
})

describe('uiLanguageSwitch', () => {
  it('leads from an English localised page to its /zh version', () => {
    expect(uiLanguageSwitch('/privacy', 'zh')).toEqual({
      kind: 'navigate',
      href: '/zh/privacy',
    })
  })

  it('leads from a Chinese localised page back to the unprefixed URL', () => {
    expect(uiLanguageSwitch('/zh/privacy', 'en')).toEqual({
      kind: 'navigate',
      href: '/privacy',
    })
  })

  it('stays on a page with no Chinese version yet', () => {
    expect(uiLanguageSwitch('/pricing', 'zh')).toEqual({ kind: 'stay' })
    expect(uiLanguageSwitch('/', 'zh')).toEqual({ kind: 'stay' })
  })
})

describe('uiLanguageOutsideLocale', () => {
  it.each([
    [undefined, undefined],
    ['zh', undefined],
    ['zh', 'zh'],
    [undefined, 'zh'],
  ])(
    'is English on a page not localised by choice (cookie %s, default %s)',
    (choice, deploymentDefault) => {
      expect(
        uiLanguageOutsideLocale({
          localisedByChoice: false,
          choice,
          deploymentDefault,
        })
      ).toBe('en')
    }
  )

  it('follows the cookie on a page localised by choice', () => {
    expect(
      uiLanguageOutsideLocale({
        localisedByChoice: true,
        choice: 'zh',
        deploymentDefault: 'en',
      })
    ).toBe('zh')
    expect(
      uiLanguageOutsideLocale({
        localisedByChoice: true,
        choice: 'en',
        deploymentDefault: 'zh',
      })
    ).toBe('en')
  })

  it('falls back to the deployment default without a valid choice', () => {
    expect(
      uiLanguageOutsideLocale({
        localisedByChoice: true,
        choice: undefined,
        deploymentDefault: 'zh',
      })
    ).toBe('zh')
    expect(
      uiLanguageOutsideLocale({
        localisedByChoice: true,
        choice: 'fr',
        deploymentDefault: 'zh',
      })
    ).toBe('zh')
  })

  it('treats an unset or unknown deployment default as English', () => {
    for (const deploymentDefault of [undefined, '', 'fr', 'ZH']) {
      expect(
        uiLanguageOutsideLocale({
          localisedByChoice: true,
          choice: undefined,
          deploymentDefault,
        })
      ).toBe('en')
    }
  })
})

describe('uiLanguageChoiceCookie', () => {
  it('keeps the choice for a year, site-wide, SameSite=Lax', () => {
    expect(UI_LANGUAGE_CHOICE_COOKIE).toBe('catglish_ui_language')
    expect(uiLanguageChoiceCookie('zh')).toBe(
      'catglish_ui_language=zh; Max-Age=31536000; Path=/; SameSite=Lax'
    )
  })
})

describe('hrefInUiLanguage', () => {
  it('prefixes a localised path on a Chinese page', () => {
    expect(hrefInUiLanguage('/privacy', 'zh')).toBe('/zh/privacy')
  })

  it('leaves a localised path unprefixed on an English page', () => {
    expect(hrefInUiLanguage('/privacy', 'en')).toBe('/privacy')
  })

  it('leaves other paths unprefixed in either language', () => {
    expect(hrefInUiLanguage('/pricing', 'zh')).toBe('/pricing')
    expect(hrefInUiLanguage('/#features', 'zh')).toBe('/#features')
    expect(hrefInUiLanguage('/app', 'zh')).toBe('/app')
  })
})

describe('localisedAlternates', () => {
  it('gives each version its own canonical and lists both languages', () => {
    const languages = { en: '/terms', zh: '/zh/terms' }
    expect(localisedAlternates('/terms', 'en')).toEqual({
      canonical: '/terms',
      languages,
    })
    expect(localisedAlternates('/terms', 'zh')).toEqual({
      canonical: '/zh/terms',
      languages,
    })
  })
})
