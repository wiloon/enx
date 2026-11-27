// The marketing header's section links, shared by the desktop nav and the
// mobile menu. They are rooted at "/" because the header is also shown on
// /pricing and /help, where a bare "#features" would point nowhere.
// Installing is the CTA's job, so there is no "Install" link. Labels are
// SiteNav message keys (messages/*.json).
export const SITE_NAV = [
  { key: 'features', href: '/#features' },
  { key: 'howItWorks', href: '/#how-it-works' },
  { key: 'pricing', href: '/pricing' },
  { key: 'whyCatglish', href: '/#compare' },
  { key: 'help', href: '/help' },
] as const
