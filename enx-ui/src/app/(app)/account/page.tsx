'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import PageHeader from '@/components/app/PageHeader'
import AccountAvatar from '@/components/app/AccountAvatar'
import { useMe } from '@/hooks/useMe'
import { joinDateLabel } from '@/lib/accountProfile'
import { totalCredits } from '@/lib/credits'
import { subscriptionStatusLabel } from '@/lib/plans'
import { apiService } from '@/services/api'

const linkClass = 'text-sm font-medium text-brand hover:underline'

// Who you are to Catglish (#211): read-only. The name, email and picture are
// edited in Clerk; plan changes happen on /billing.
export default function AccountPage() {
  const { me, isLoading, error } = useMe()

  return (
    <div className="container mx-auto max-w-2xl space-y-6 p-6 md:p-8">
      <PageHeader
        title="Account"
        description="Your profile, your account ID for support, your plan and your invite link."
      />

      {isLoading && <p className="text-muted-foreground">Loading...</p>}
      {error && (
        <p className="text-destructive">
          {error instanceof Error ? error.message : 'Failed to load account'}
        </p>
      )}

      {me && (
        <>
          <Card>
            <CardHeader>
              <CardTitle role="heading" aria-level={2}>
                Profile
              </CardTitle>
            </CardHeader>
            <CardContent className="flex items-center gap-4">
              <AccountAvatar me={me} className="size-14 text-base" />
              <div className="min-w-0 space-y-0.5">
                <p className="truncate font-medium">{me.name}</p>
                <p className="truncate text-sm text-muted-foreground">
                  {me.email}
                </p>
                {joinDateLabel(me.createdAt) && (
                  <p className="text-xs text-muted-foreground">
                    Joined {joinDateLabel(me.createdAt)}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle role="heading" aria-level={2}>
                Account ID
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-3 py-2 font-mono text-sm">
                  {me.id}
                </code>
                <CopyButton text={me.id} label="Copy account ID" idle="Copy" />
              </div>
              <p className="text-xs text-muted-foreground">
                Share this with support so they can find your account.
              </p>
            </CardContent>
          </Card>
        </>
      )}

      <PlanCard />
      <InviteCard />
    </div>
  )
}

function PlanCard() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['billing-me'],
    queryFn: async () => {
      const resp = await apiService.getBillingMe()
      if (resp.success && resp.data) return resp.data
      throw new Error(resp.error || 'Failed to load billing status')
    },
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          Plan &amp; credits
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && (
          <p className="text-sm text-muted-foreground">Loading...</p>
        )}
        {error && (
          <p className="text-sm text-destructive">
            {error instanceof Error
              ? error.message
              : 'Failed to load billing status'}
          </p>
        )}
        {data && (
          <div className="flex items-baseline justify-between gap-4 text-sm">
            <span className="font-medium">
              {subscriptionStatusLabel(
                data.subscription.status,
                data.subscription.plan
              )}
            </span>
            <span className="tabular-nums text-muted-foreground">
              {`${totalCredits(data.credits).toLocaleString('en-US')} credits`}
            </span>
          </div>
        )}
        <Link href="/billing" className={linkClass}>
          Go to Billing
        </Link>
      </CardContent>
    </Card>
  )
}

function InviteCard() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['referral-me'],
    queryFn: async () => {
      const resp = await apiService.getReferralMe()
      if (resp.success && resp.data) return resp.data
      throw new Error(resp.error || 'Failed to load your invites')
    },
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          Invite friends
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && (
          <p className="text-sm text-muted-foreground">Loading...</p>
        )}
        {error && (
          <p className="text-sm text-destructive">
            {error instanceof Error
              ? error.message
              : 'Failed to load your invites'}
          </p>
        )}
        {data && (
          <div className="flex gap-2">
            <Input
              readOnly
              aria-label="Your invite link"
              value={data.link}
              onFocus={(e) => e.currentTarget.select()}
            />
            <CopyButton text={data.link} label="Copy link" idle="Copy link" />
          </div>
        )}
        <Link href="/invite" className={linkClass}>
          See your invites
        </Link>
      </CardContent>
    </Card>
  )
}

function CopyButton({
  text,
  label,
  idle,
}: {
  text: string
  label: string
  idle: string
}) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch (err) {
      // No clipboard (an insecure origin, a denied permission): the text
      // stays on screen, selectable by hand.
      console.info('Copy failed:', err)
    }
  }

  return (
    <Button variant="outline" aria-label={label} onClick={copy}>
      {copied ? 'Copied' : idle}
    </Button>
  )
}
