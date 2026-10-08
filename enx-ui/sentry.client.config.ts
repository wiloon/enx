import * as Sentry from '@sentry/nextjs'

// No Session Replay: it records visitors' clicks, mouse movement and
// scrolling, which the privacy policy does not cover. Whether to turn it on
// later is WIL-131.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 1.0,
  debug: false,
})
