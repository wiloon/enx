'use client'

import type { ReactNode } from 'react'
import { SITE } from '@/lib/site'
import { useExtensionStatus } from '@/hooks/useExtensionStatus'

// Client island: a Chrome Web Store link that steps aside once the extension
// answers (ADR-019 detection). While the check is pending it renders an
// invisible stand-in of the same size, so a viewer who has the extension never
// sees the link flash and neighbouring items do not shift when it fades in.
export default function ChromeStoreCta({
  className,
  children,
  installed = null,
}: {
  className: string
  children: ReactNode
  // Rendered instead of the store link when the extension is installed.
  installed?: ReactNode
}) {
  const status = useExtensionStatus()
  if (status === 'installed') return installed

  if (status === 'unknown') {
    return (
      <span aria-hidden="true" className={`${className} invisible`}>
        {children}
      </span>
    )
  }

  return (
    <a
      href={SITE.chromeWebStoreUrl}
      target="_blank"
      rel="noreferrer"
      className={`${className} motion-safe:animate-in motion-safe:fade-in motion-safe:duration-150`}
    >
      {children}
    </a>
  )
}
