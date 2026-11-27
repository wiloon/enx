import { render, type RenderOptions } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import en from '../../messages/en.json'
import zh from '../../messages/zh.json'
import type { UiLanguage } from '@/lib/uiLanguage'

// The root layouts wrap every page in NextIntlClientProvider; components that
// read messages need the same in a test.

const MESSAGES = { en, zh }

export function IntlWrapper(language: UiLanguage = 'en') {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <NextIntlClientProvider locale={language} messages={MESSAGES[language]}>
        {children}
      </NextIntlClientProvider>
    )
  }
}

export function renderWithIntl(
  ui: React.ReactElement,
  language: UiLanguage = 'en',
  options?: Omit<RenderOptions, 'wrapper'>
) {
  return render(ui, { wrapper: IntlWrapper(language), ...options })
}
