'use client'

import { useState } from 'react'
import { CircleUser } from 'lucide-react'
import { initialsOf } from '@/lib/accountProfile'
import { cn } from '@/lib/utils'
import type { MeData } from '@/types'

// The account's picture, its initials when there is none or it fails to
// load, or a generic icon while GET /api/me is pending or has failed (#211).
// Decorative: the name is always written next to it or in an aria-label.
export default function AccountAvatar({
  me,
  className,
}: {
  me: MeData | undefined
  className?: string
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const base = cn(
    'flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full',
    className
  )

  if (!me) {
    return (
      <span
        aria-hidden
        data-testid="account-avatar-placeholder"
        className={cn(base, 'bg-muted text-muted-foreground')}
      >
        <CircleUser className="size-5" />
      </span>
    )
  }

  if (me.avatarUrl && me.avatarUrl !== failedUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- Clerk serves the picture from its own CDN; next/image would need every host configured.
      <img
        src={me.avatarUrl}
        alt=""
        aria-hidden
        referrerPolicy="no-referrer"
        onError={() => setFailedUrl(me.avatarUrl)}
        className={cn(base, 'object-cover')}
      />
    )
  }

  return (
    <span
      aria-hidden
      className={cn(base, 'bg-brand/15 text-xs font-semibold text-brand')}
    >
      {initialsOf(me.name, me.email)}
    </span>
  )
}
