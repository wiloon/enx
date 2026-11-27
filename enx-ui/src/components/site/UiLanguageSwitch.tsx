'use client'

import { Languages } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { usePathname, useRouter } from 'next/navigation'
import {
  UI_LANGUAGES,
  uiLanguageChoiceCookie,
  uiLanguageSwitch,
  type UiLanguage,
} from '@/lib/uiLanguage'

// The UI language switch (ADR-096 Decision 4), in the header bar and in the
// mobile menu. It is the only writer of the choice cookie. A localised page
// moves to its other-language URL; the change between root layouts is a full
// page load. Any other page stays where it is: it is English whatever the
// choice, until it is localised by choice.

// Each name is written in its own language, so it is marked as such.
const LANG_ATTR: Record<UiLanguage, string> = { en: 'en', zh: 'zh-Hans' }

function recordChoice(language: UiLanguage) {
  document.cookie = uiLanguageChoiceCookie(language)
}

export default function UiLanguageSwitch({
  variant,
  className = '',
  onSwitch,
}: {
  variant: 'bar' | 'menu'
  className?: string
  onSwitch?: () => void
}) {
  const t = useTranslations('UiLanguageSwitch')
  const current = useLocale()
  const pathname = usePathname()
  const router = useRouter()

  const choose = (language: UiLanguage) => {
    recordChoice(language)
    onSwitch?.()
    const next = uiLanguageSwitch(pathname, language)
    if (next.kind === 'navigate') router.push(next.href)
  }

  if (variant === 'bar') {
    // Two languages: the bar offers the other one.
    const other = UI_LANGUAGES.find((l) => l !== current) ?? 'en'
    return (
      <button
        type="button"
        onClick={() => choose(other)}
        title={t('label')}
        className={`items-center gap-1.5 ${className}`}
      >
        <Languages aria-hidden className="h-4 w-4" />
        <span lang={LANG_ATTR[other]}>{t(other)}</span>
      </button>
    )
  }

  return (
    <div role="group" aria-label={t('label')} className={className}>
      <p className="px-3 pt-2 text-xs font-medium text-muted-foreground">
        {t('label')}
      </p>
      <div className="flex gap-1 px-1 pt-1">
        {UI_LANGUAGES.map((language) => {
          const isCurrent = language === current
          return (
            <button
              key={language}
              type="button"
              lang={LANG_ATTR[language]}
              aria-current={isCurrent ? 'true' : undefined}
              onClick={() => choose(language)}
              className={`rounded-md px-3 py-2 text-base transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
                isCurrent ? 'font-medium text-foreground' : 'text-foreground/70'
              }`}
            >
              {t(language)}
            </button>
          )
        })}
      </div>
    </div>
  )
}
