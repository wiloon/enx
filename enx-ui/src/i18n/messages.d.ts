import type { UiLanguage } from '@/lib/uiLanguage'
import type messages from '../../messages/en.json'

// en.json is the source of the message types (ADR-096 Decision 6): a key it
// lacks fails the typecheck. messages.test.ts keeps zh.json in step.
declare module 'next-intl' {
  interface AppConfig {
    Locale: UiLanguage
    Messages: typeof messages
  }
}
