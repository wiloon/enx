import * as Sentry from '@sentry/react'
import { config } from '@/config/env'
import { readBuildEnv } from '@/config/buildEnv'

export const initSentry = () => {
  const dsn = readBuildEnv('VITE_SENTRY_DSN')
  if (!dsn) {
    return
  }

  // No Session Replay: it records clicks, mouse movement and scrolling, which
  // is "User activity" on the Web Store's data-usage form and is not in the
  // privacy policy. Errors and stack traces are enough for these small pages.
  Sentry.init({
    dsn,
    environment: config.environment,
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: 1.0,
  })
}

export { Sentry }
