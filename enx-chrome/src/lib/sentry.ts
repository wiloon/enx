import * as Sentry from '@sentry/react'
import { config } from '@/config/env'

export const initSentry = () => {
  const dsn = import.meta.env.VITE_SENTRY_DSN
  if (!dsn) {
    return
  }

  Sentry.init({
    dsn,
    environment: config.environment,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration(),
    ],
    tracesSampleRate: 1.0,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
  })
}

export { Sentry }
