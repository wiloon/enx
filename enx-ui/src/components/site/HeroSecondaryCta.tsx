'use client'

import Link from 'next/link'
import { useExtensionStatus } from '@/hooks/useExtensionStatus'

const OUTLINE =
  'w-full rounded-md border border-border px-5 py-2.5 text-sm font-medium transition-colors hover:bg-muted active:bg-muted/80 sm:w-auto'

// Client island beside the Hero's primary CTA. Word lookups need the
// extension, so the sample article is only worth a click once it is installed;
// before that the visitor gets the three-step explainer. Like ChromeStoreCta,
// it holds an invisible stand-in while detection is pending, so the label
// never flips under the cursor.
export default function HeroSecondaryCta() {
  const status = useExtensionStatus()

  if (status === 'unknown') {
    return (
      <span aria-hidden="true" className={`${OUTLINE} invisible`}>
        See how it works
      </span>
    )
  }

  if (status === 'installed') {
    return (
      <Link href="/reader/sample" className={OUTLINE}>
        Try it on a sample article
      </Link>
    )
  }

  return (
    <a href="#how-it-works" className={OUTLINE}>
      See how it works
    </a>
  )
}
