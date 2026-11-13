// Marketing-site constants (ADR-013). One place for every "TODO: real value"
// so launch prep is a single-file review.

export const SITE = {
  name: 'Catglish',
  tagline: 'Learn English while you read the web',
  subtitle:
    'Click any word for its meaning. Select a sentence to translate it.',

  chromeExtensionId: 'combdcldlodkikjfhjbdbogjlfmnbjkf',
  chromeWebStoreUrl:
    'https://chromewebstore.google.com/detail/catglish-learn-english-as/combdcldlodkikjfhjbdbogjlfmnbjkf',
  edgeAddonUrl: '', // empty => "Coming soon"
  firefoxAddonUrl: '',

  githubUrl: 'https://github.com/wiloon/enx',

  // Release stage shown as a badge next to the logo. Empty => no badge; clear
  // it at general availability.
  stage: 'Beta',

  // Demo video slot (ADR-013 Decision 6). Empty => poster + "Demo coming soon".
  // Served from the catglish-media R2 bucket (w10n-config, catglish/r2.tf),
  // not the repo: a new cut is uploaded under a new -vN key and changed here.
  demoVideoUrl: 'https://media.catglish.com/demo/demo-full-v1.mp4',
  demoPoster: 'https://media.catglish.com/demo/demo-poster-v1.jpg',

  appPath: '/app',
} as const
