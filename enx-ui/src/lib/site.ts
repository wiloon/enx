// Marketing-site constants (ADR-013). One place for every "TODO: real value"
// so launch prep is a single-file review.

export const SITE = {
  name: 'Catglish',
  tagline: 'Learn English while you read the web',
  subtitle:
    'Catglish is a browser extension for AI-assisted English reading. Turn it on for any English page — click any word for its meaning, select a sentence to translate it. Every word you look up goes into your word list and is underlined wherever it shows up again, fading the more often you look it up.',

  // TODO: real Chrome Web Store listing id
  chromeWebStoreUrl: 'https://chromewebstore.google.com/',
  edgeAddonUrl: '', // empty => "Coming soon"
  firefoxAddonUrl: '',

  githubUrl: 'https://github.com/wiloon/enx',

  // Release stage shown as a badge next to the logo. Empty => no badge; clear
  // it at general availability.
  stage: 'Beta',

  // Demo video slot (ADR-013 Decision 6). Empty => poster + "Demo coming soon".
  demoVideoUrl: '',
  demoPoster: '/marketing/demo-poster.svg',

  appPath: '/app',
} as const
