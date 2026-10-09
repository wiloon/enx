'use client'

import type { MouseEvent, ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

// The header logo. Off the landing page it is a plain link home. On it,
// Next sees "/#features" -> "/" as the same page and leaves the scroll
// position alone, so scroll back to the top ourselves and drop the hash.
export default function HomeLink({
  className,
  children,
}: {
  className: string
  children: ReactNode
}) {
  const pathname = usePathname()

  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    // Let modified clicks (new tab / window) through untouched.
    if (pathname !== '/' || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
      return
    e.preventDefault()
    const reduceMotion = window.matchMedia?.(
      '(prefers-reduced-motion: reduce)'
    ).matches
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' })
    if (window.location.hash) history.replaceState(history.state, '', '/')
  }

  return (
    <Link href="/" className={className} onClick={onClick}>
      {children}
    </Link>
  )
}
