'use client'

import Link from 'next/link'
import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import CreditBalance from '@/components/admin/CreditBalance'
import { Input } from '@/components/ui/input'
import PageHeader from '@/components/app/PageHeader'
import { utcDate } from '@/lib/adminUsers'
import { apiService } from '@/services/api'
import type { AdminUserSort, AdminUserSummary } from '@/types'

const PAGE_SIZE = 50

const SORTS: { value: AdminUserSort; label: string }[] = [
  { value: 'created', label: 'Newest account' },
  { value: 'last_login', label: 'Last sign-in' },
  { value: 'balance', label: 'Balance' },
]

function planLabel(u: AdminUserSummary): string {
  return u.plan ? `${u.plan} · ${u.subscriptionStatus}` : 'Free'
}

// The users page (ADR-049 Decision 11): who signed up, what they hold and
// where it came from. Balances are credits; money stays in Stripe.
export default function AdminUsersPage() {
  const [sort, setSort] = useState<AdminUserSort>('created')
  const [draft, setDraft] = useState('')
  const [q, setQ] = useState('')
  const [offset, setOffset] = useState(0)

  const query = useQuery({
    queryKey: ['admin-users', q, sort, offset],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const resp = await apiService.adminListUsers({
        q,
        sort,
        limit: PAGE_SIZE,
        offset,
      })
      if (resp.success && resp.data) return resp.data
      throw new Error(resp.error || 'Failed to load users')
    },
  })

  const total = query.data?.total ?? 0

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 md:p-8">
      <PageHeader
        title="Users"
        description="Accounts, credit balances and where the credits came from."
      />

      <div className="flex flex-wrap items-end gap-3">
        <form
          role="search"
          className="flex w-full min-w-0 gap-2 sm:w-auto sm:flex-1"
          onSubmit={(e) => {
            e.preventDefault()
            setQ(draft.trim())
            setOffset(0)
          }}
        >
          <Input
            type="search"
            aria-label="Search by email"
            placeholder="Search by email"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="min-w-0 flex-1 sm:max-w-xs"
          />
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          Sort by
          <select
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as AdminUserSort)
              setOffset(0)
            }}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {query.isLoading
              ? 'Loading…'
              : query.isError
                ? 'Could not load'
                : `${total} ${total === 1 ? 'user' : 'users'}`}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {query.isError && (
            <p role="alert" className="text-sm text-destructive">
              {(query.error as Error).message}
            </p>
          )}
          {query.isSuccess && query.data.users.length === 0 && (
            <p className="text-sm text-muted-foreground">No users match.</p>
          )}
          {query.isSuccess && query.data.users.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Email</th>
                    <th className="py-2 pr-3 font-medium">Plan</th>
                    <th className="py-2 pr-3 font-medium">Last sign-in</th>
                    <th className="py-2 pr-3 text-right font-medium">
                      Balance
                    </th>
                    <th className="py-2 pr-3 text-right font-medium">Paid</th>
                    <th className="py-2 pr-3 text-right font-medium">Gifted</th>
                    <th className="py-2 text-right font-medium">Consumed</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.users.map((u: AdminUserSummary) => (
                    <tr key={u.id} className="border-b border-border/60">
                      <td className="py-2 pr-3">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/admin/users/${u.id}`}
                            className="font-medium hover:underline"
                          >
                            {u.email}
                          </Link>
                          {u.hadClawback && (
                            <Badge variant="outline">Refunded</Badge>
                          )}
                        </div>
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {planLabel(u)}
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap font-mono text-xs">
                        {utcDate(u.lastLoginAt)}
                      </td>
                      <td className="py-2 pr-3 text-right">
                        <CreditBalance value={u.balances.total} />
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {u.totals.paid}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {u.totals.gifted}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {u.totals.consumed}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {total > 0 && (
            <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
              <span>
                {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={offset + PAGE_SIZE >= total}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
