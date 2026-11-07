// The marketing header's section links, shared by the desktop nav and the
// mobile menu. They are rooted at "/" because the header is also shown on
// /pricing and /help, where a bare "#features" would point nowhere.
// Installing is the CTA's job, so there is no "Install" link.
export const SITE_NAV: readonly { label: string; href: string }[] = [
  { label: 'Features', href: '/#features' },
  { label: 'How it works', href: '/#how-it-works' },
  { label: 'Pricing', href: '/pricing' },
  { label: 'Similar apps', href: '/#compare' },
  { label: 'Help', href: '/help' },
]
