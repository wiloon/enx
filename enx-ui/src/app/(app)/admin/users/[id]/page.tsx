'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import PageHeader from '@/components/app/PageHeader'
import CreditTimeline from '@/components/app/CreditTimeline'
import AccountActions from '@/components/admin/AccountActions'
import AdjustCreditsForm from '@/components/admin/AdjustCreditsForm'
import CreditBalance from '@/components/admin/CreditBalance'
import { utcDate } from '@/lib/adminUsers'
import { apiService } from '@/services/api'
import type { AdminUserDetail, CreditDirection } from '@/types'

// One user's account, usage and credit ledger (ADR-049 Decision 11), with
// the admin grant and deduction forms (Decisions 2-3) and the account
// actions: sign out, disable, delete (ADR-062).
export default function AdminUserPage() {
  const { id } = useParams<{ id: string }>()

  const query = useQuery({
    queryKey: ['admin-user', id],
    queryFn: async () => {
      const resp = await apiService.adminGetUser(id)
      if (resp.success && resp.data) return resp.data
      throw new Error(resp.error || 'Failed to load user')
    },
  })

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6 md:p-8">
      <Link
        href="/admin/users"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Users
      </Link>

      {query.isLoading && (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}
      {query.isError && (
        <p role="alert" className="text-sm text-destructive">
          {(query.error as Error).message}
        </p>
      )}
      {query.isSuccess && <UserDetail detail={query.data} />}
    </div>
  )
}

function UserDetail({ detail }: { detail: AdminUserDetail }) {
  const { user } = detail
  const queryClient = useQueryClient()
  const plan = user.plan ? `${user.plan} · ${user.subscriptionStatus}` : 'Free'

  return (
    <>
      <PageHeader
        title={user.email}
        description={[
          user.name,
          plan,
          `joined ${utcDate(user.createdAt)}`,
          `last sign-in ${utcDate(user.lastLoginAt)}`,
        ]
          .filter(Boolean)
          .join(' · ')}
        actions={
          user.stripeDashboardUrl ? (
            <a
              href={user.stripeDashboardUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm font-medium hover:underline"
            >
              Stripe Dashboard
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </a>
          ) : (
            <span className="text-sm text-muted-foreground">
              No Stripe customer
            </span>
          )
        }
      />

      <div className="grid gap-6 md:grid-cols-2">
        <Card role="region" aria-labelledby="balances-title">
          <CardHeader>
            <CardTitle id="balances-title" className="text-base">
              Balances
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Total</dt>
              <dd className="text-right text-lg font-semibold">
                <CreditBalance value={user.balances.total} />
              </dd>
              <dt className="text-muted-foreground">Subscription</dt>
              <dd className="text-right">
                <CreditBalance value={user.balances.subscription} />
              </dd>
              <dt className="text-muted-foreground">Top-up</dt>
              <dd className="text-right">
                <CreditBalance value={user.balances.topup} />
              </dd>
              <dt className="text-muted-foreground">
                Trial
                {user.balances.trial > 0 && user.balances.trialExpiresAt && (
                  <span className="block text-xs">
                    expires {utcDate(user.balances.trialExpiresAt)}
                  </span>
                )}
              </dt>
              <dd className="text-right">
                <CreditBalance value={user.balances.trial} />
              </dd>
            </dl>
          </CardContent>
        </Card>

        <Card role="region" aria-labelledby="lifetime-title">
          <CardHeader>
            <CardTitle id="lifetime-title" className="text-base">
              Lifetime
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Paid</dt>
              <dd className="text-right tabular-nums">{user.totals.paid}</dd>
              <dt className="text-muted-foreground">Gifted</dt>
              <dd className="text-right tabular-nums">{user.totals.gifted}</dd>
              <dt className="text-muted-foreground">Trial</dt>
              <dd className="text-right tabular-nums">{user.totals.trial}</dd>
              <dt className="text-muted-foreground">Consumed</dt>
              <dd className="text-right tabular-nums">
                {user.totals.consumed}
              </dd>
              <dt className="text-muted-foreground">Clawed back</dt>
              <dd className="text-right tabular-nums">
                {user.totals.clawedBack}
              </dd>
            </dl>
          </CardContent>
        </Card>
      </div>

      <Usage detail={detail} />

      <Card role="region" aria-labelledby="adjust-title">
        <CardHeader>
          <CardTitle id="adjust-title" className="text-base">
            Adjust credits
          </CardTitle>
        </CardHeader>
        <CardContent>
          <AdjustCreditsForm
            userId={user.id}
            email={user.email}
            topupBalance={user.balances.topup}
            onAdjusted={() => {
              queryClient.invalidateQueries({
                queryKey: ['admin-user', user.id],
              })
              queryClient.invalidateQueries({
                queryKey: ['admin-user-ledger', user.id],
              })
            }}
          />
        </CardContent>
      </Card>

      <Ledger userId={user.id} />

      <Card role="region" aria-labelledby="account-title">
        <CardHeader>
          <CardTitle id="account-title" className="text-base">
            Account
          </CardTitle>
        </CardHeader>
        <CardContent>
          <AccountActions
            userId={user.id}
            email={user.email}
            status={user.status}
            onChanged={() =>
              queryClient.invalidateQueries({
                queryKey: ['admin-user', user.id],
              })
            }
          />
        </CardContent>
      </Card>
    </>
  )
}

// Every credit_transactions row, newest first, a page at a time: the user's
// own timeline (ADR-063) plus the admin fields.
function Ledger({ userId }: { userId: string }) {
  const load = async (before: string, direction: CreditDirection) => {
    const resp = await apiService.adminListUserTransactions(
      userId,
      before,
      direction
    )
    if (resp.success && resp.data) return resp.data
    throw new Error(resp.error || 'Failed to load the ledger')
  }

  return (
    <Card role="region" aria-labelledby="ledger-title">
      <CardHeader>
        <CardTitle id="ledger-title" className="text-base">
          Ledger
        </CardTitle>
      </CardHeader>
      <CardContent>
        <CreditTimeline
          queryKey={['admin-user-ledger', userId]}
          load={load}
          admin
        />
      </CardContent>
    </Card>
  )
}

// Counts only (ADR-049 Decision 12): how much the user looked up and spent,
// never which words or pages.
function Usage({ detail }: { detail: AdminUserDetail }) {
  const lookups = detail.dailyLookups.reduce((sum, d) => sum + d.count, 0)
  const peak = Math.max(1, ...detail.dailyLookups.map((d) => d.count))

  return (
    <Card role="region" aria-labelledby="usage-title">
      <CardHeader>
        <CardTitle id="usage-title" className="text-base">
          Last 30 days
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <p className="text-sm">
            {lookups} {lookups === 1 ? 'lookup' : 'lookups'}
          </p>
          <div className="flex h-24 items-end gap-0.5" aria-hidden="true">
            {detail.dailyLookups.map((d) => (
              <div
                key={d.date}
                title={`${d.date}: ${d.count} ${d.count === 1 ? 'lookup' : 'lookups'}`}
                className="min-h-px flex-1 rounded-sm bg-primary/70"
                style={{ height: `${(d.count / peak) * 100}%` }}
              />
            ))}
          </div>
          <div className="flex justify-between font-mono text-xs text-muted-foreground">
            <span>{detail.dailyLookups[0]?.date}</span>
            <span>{detail.dailyLookups.at(-1)?.date} (UTC)</span>
          </div>
        </div>

        {detail.aiSpend.length === 0 ? (
          <p className="text-sm text-muted-foreground">No AI spend.</p>
        ) : (
          <table aria-label="AI spend" className="w-full text-left text-sm">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="py-2 pr-3 font-medium">AI feature</th>
                <th className="py-2 text-right font-medium">Credits</th>
              </tr>
            </thead>
            <tbody>
              {detail.aiSpend.map((s) => (
                <tr key={s.feature} className="border-b border-border/60">
                  <td className="py-2 pr-3 font-mono text-xs">{s.feature}</td>
                  <td className="py-2 text-right tabular-nums">{s.credits}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  )
}
