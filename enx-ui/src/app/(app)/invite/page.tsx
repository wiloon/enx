'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import PageHeader from '@/components/app/PageHeader'
import { pendingRewardLabel } from '@/lib/referral'
import { apiService } from '@/services/api'

// The user's invite link and how their invites are doing (ADR-051 Decision
// 8). Rewards wait out the friend's refund window, so the pending ones are
// listed with their expected dates; otherwise a user would think nothing
// happened.
export default function InvitePage() {
  const [copied, setCopied] = useState(false)

  const { data, isLoading, error } = useQuery({
    queryKey: ['referral-me'],
    queryFn: async () => {
      const resp = await apiService.getReferralMe()
      if (resp.success && resp.data) return resp.data
      throw new Error(resp.error || 'Failed to load your invites')
    },
  })

  const copyLink = async () => {
    if (!data) return
    try {
      await navigator.clipboard.writeText(data.link)
      setCopied(true)
    } catch (err) {
      // No clipboard (an insecure origin, a denied permission): the link
      // stays in the field, selectable by hand.
      console.info('Copy failed:', err)
    }
  }

  return (
    <div className="container mx-auto max-w-3xl space-y-6 p-6 md:p-8">
      <PageHeader
        title="Invite friends"
        description="Friends who join through your link get bonus AI credits. When a friend makes their first payment, you earn credits once its refund window has passed."
      />

      {isLoading && <p className="text-muted-foreground">Loading...</p>}
      {error && (
        <p className="text-destructive">
          {error instanceof Error
            ? error.message
            : 'Failed to load your invites'}
        </p>
      )}

      {data && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Your invite link</CardTitle>
            </CardHeader>
            <CardContent className="flex gap-2">
              <Input
                readOnly
                aria-label="Your invite link"
                value={data.link}
                onFocus={(e) => e.currentTarget.select()}
              />
              <Button variant="brand" onClick={copyLink}>
                {copied ? 'Copied' : 'Copy link'}
              </Button>
            </CardContent>
          </Card>

          <div className="grid grid-cols-3 gap-4">
            <Stat
              testId="invite-stat-invited"
              label="Invited"
              value={data.invited}
            />
            <Stat testId="invite-stat-paid" label="Paid" value={data.paid} />
            <Stat
              testId="invite-stat-earned"
              label="Credits earned"
              value={data.totalEarned}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Pending rewards</CardTitle>
            </CardHeader>
            <CardContent>
              {data.pendingRewards.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No pending rewards.
                </p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {data.pendingRewards.map((r, i) => (
                    <li key={i}>{pendingRewardLabel(r)}</li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

function Stat({
  testId,
  label,
  value,
}: {
  testId: string
  label: string
  value: number
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div data-testid={testId} className="text-2xl font-semibold">
          {value.toLocaleString('en-US')}
        </div>
      </CardContent>
    </Card>
  )
}
