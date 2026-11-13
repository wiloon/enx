import { SITE } from './site'

export const HELP_GUIDES = [
  {
    href: '/help/install',
    title: 'Install from the Chrome Web Store',
    description: 'Find the extension, add it to Chrome and continue setup.',
  },
  {
    href: '/help/install/offline',
    title: 'Install manually from a ZIP file',
    description: 'Use the GitHub download when you cannot access the store.',
  },
  {
    href: '/help/get-started',
    title: `Get started with ${SITE.name}`,
    description: 'Pin the icon, sign in and look up your first word.',
  },
  {
    href: '/help/rephrase',
    title: 'Rephrase into idiomatic English',
    description:
      'Turn Chinese or rough English into natural workplace English.',
  },
] as const

// Temporary installation note; remove this and its uses when #560 is verified.
export const ENHANCED_PROTECTION_NOTE = `With Enhanced protection enabled, Chrome may show “Proceed with caution” because ${SITE.name} is not yet trusted by Enhanced Safe Browsing. To proceed, select “Continue to install”.`
