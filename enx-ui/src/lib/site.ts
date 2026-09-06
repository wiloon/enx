// Marketing-site constants (ADR-013). One place for every "TODO: real value"
// so launch prep is a single-file review.

export const SITE = {
  name: 'Catseye',
  tagline: 'Learn English while you read the web',
  subtitle:
    'Catseye is a browser extension for AI-assisted English reading. Turn it on for any English page — new words get underlined by difficulty, click any word for its meaning, select a sentence to translate it. Everything you look up flows into your vocabulary list and review system.',

  // TODO: real Chrome Web Store listing id
  chromeWebStoreUrl: 'https://chromewebstore.google.com/',
  edgeAddonUrl: '', // empty => "Coming soon"
  firefoxAddonUrl: '',

  githubUrl: 'https://github.com/wiloon/enx',

  // Demo video slot (ADR-013 Decision 6). Empty => poster + "Demo coming soon".
  demoVideoUrl: '',
  demoPoster: '/marketing/demo-poster.svg',

  appPath: '/app',
} as const
