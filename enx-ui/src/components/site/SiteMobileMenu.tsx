'use client'

import { useEffect, useRef, useState } from 'react'
import { Menu, X } from 'lucide-react'
import { SITE } from '@/lib/site'
import ChromeStoreCta from './ChromeStoreCta'
import { SITE_NAV } from './siteNav'

const linkClass =
  'block rounded-md px-3 py-2 text-base text-foreground/70 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

// Client island: the marketing header's menu below the lg breakpoint. The
// panel drops down under the sticky header. Choosing a link closes it, so a
// same-page anchor such as /#features is not left covered by the panel.
export default function SiteMobileMenu() {
  const [open, setOpen] = useState(false)
  const toggleRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      toggleRef.current?.focus()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  const close = () => setOpen(false)

  return (
    <div className="lg:hidden">
      <button
        ref={toggleRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="site-menu"
        aria-label={open ? 'Close menu' : 'Open menu'}
        className="rounded-md p-1.5 text-foreground/70 hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {open ? (
          <X aria-hidden className="h-5 w-5" />
        ) : (
          <Menu aria-hidden className="h-5 w-5" />
        )}
      </button>

      {/* Kept mounted and toggled with `hidden`, so the CTA's extension check
          has already finished when the menu opens. */}
      <nav
        id="site-menu"
        aria-label="Menu"
        hidden={!open}
        className="absolute inset-x-0 top-full border-b border-border/60 bg-background shadow-sm"
      >
        <ul className="mx-auto max-w-6xl space-y-1 px-4 py-3 sm:px-6">
          {SITE_NAV.map((item) => (
            <li key={item.href}>
              <a href={item.href} onClick={close} className={linkClass}>
                {item.label}
              </a>
            </li>
          ))}
          <li>
            <a
              href={SITE.githubUrl}
              target="_blank"
              rel="noreferrer"
              onClick={close}
              className={linkClass}
            >
              GitHub
            </a>
          </li>
          {/* Below sm the bar has no room for the CTA, so it moves here. */}
          <li className="pt-2 sm:hidden">
            <ChromeStoreCta className="block rounded-md bg-brand px-3 py-2 text-center text-base font-medium text-brand-foreground transition-opacity hover:opacity-90 active:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              Add to Chrome
            </ChromeStoreCta>
          </li>
        </ul>
      </nav>
    </div>
  )
}
