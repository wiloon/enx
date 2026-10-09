'use client'

import type { ReactNode } from 'react'
import { SITE } from '@/lib/site'
import { useExtensionStatus } from '@/hooks/useExtensionStatus'

// Client island: a Chrome Web Store link that steps aside once the extension
// answers (ADR-019 detection). It stays visible while the check is pending so
// first-time visitors -- the audience it is for -- never see it flash in.
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
  if (useExtensionStatus() === 'installed') return installed

  return (
    <a
      href={SITE.chromeWebStoreUrl}
      target="_blank"
      rel="noreferrer"
      className={className}
    >
      {children}
    </a>
  )
}
