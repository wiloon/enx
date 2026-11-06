import Link from 'next/link'
import type { ReactNode } from 'react'
import SiteHeader from '@/components/site/SiteHeader'
import SiteFooter from '@/components/site/SiteFooter'
import { SITE } from '@/lib/site'

const links = [
  { href: '/help', label: 'Help home' },
  { href: '/help/install', label: 'Chrome Web Store' },
  { href: '/help/install/offline', label: 'Manual installation' },
  { href: '/help/get-started', label: 'Get started' },
  { href: SITE.appPath, label: 'Go to app' },
]

export default function HelpLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      <div className="border-b border-brand/20 bg-brand/5">
        <nav
          aria-label="Help guides"
          className="mx-auto flex max-w-4xl flex-wrap gap-x-6 gap-y-3 px-6 py-4 text-sm"
        >
          {links.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className="rounded-sm font-medium text-brand hover:underline active:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
            >
              {label}
            </Link>
          ))}
        </nav>
      </div>
      <main className="mx-auto min-h-[60vh] max-w-3xl space-y-8 p-6 leading-relaxed [overflow-wrap:anywhere] md:py-12 [&_a]:rounded-sm [&_a]:text-brand [&_a]:underline-offset-4 [&_a:hover]:underline [&_a:active]:opacity-80 [&_a:focus-visible]:outline-2 [&_a:focus-visible]:outline-offset-4 [&_a:focus-visible]:outline-ring [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-sm">
        {children}
      </main>
      <SiteFooter />
    </>
  )
}
