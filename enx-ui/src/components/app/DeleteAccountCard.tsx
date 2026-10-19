'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/hooks/useAuth'
import { emailMatches } from '@/lib/account'
import { apiService } from '@/services/api'

// Self-serve account deletion (ADR-062 Decision 2): a hard delete, confirmed
// by typing the account's email. A refusal (an active subscription) comes
// back with enx-api's message.
export default function DeleteAccountCard() {
  const { logout } = useAuth()
  const [typed, setTyped] = useState('')

  // The email enx-api holds, the one it compares the confirmation with.
  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const resp = await apiService.getMe()
      if (resp.success && resp.data) return resp.data
      throw new Error(resp.error || 'Failed to load account')
    },
  })

  const remove = useMutation({
    mutationFn: async (email: string) => {
      const resp = await apiService.deleteMyAccount(email)
      if (resp.success) return
      throw new Error(resp.error || 'Could not delete the account')
    },
    // The Clerk user is gone too; end the session on this device.
    onSuccess: () => logout(),
  })

  const confirmed = me !== undefined && emailMatches(typed, me.email)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Delete account</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>
            Deleting your account removes your word list, reading statistics,
            saved pages, reader documents and settings for good. It cannot be
            undone.
          </p>
          <p>
            Any remaining trial, subscription and top-up credits are lost.
            Deleting your account does not refund anything: to ask for a refund,
            follow the{' '}
            <Link href="/refund" className="underline">
              Refund Policy
            </Link>{' '}
            before you delete it. Cancel an active subscription on the{' '}
            <Link href="/billing" className="underline">
              Billing
            </Link>{' '}
            page first.
          </p>
          <p>
            If you sign up again with the same email, you will not get trial
            credits or invite rewards again.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="delete-account-email">
            Type your email to confirm
          </Label>
          <Input
            id="delete-account-email"
            type="email"
            autoComplete="off"
            placeholder={me?.email}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            disabled={remove.isPending}
          />
        </div>

        <Button
          variant="destructive"
          disabled={!confirmed || remove.isPending}
          onClick={() => remove.mutate(typed.trim())}
        >
          {remove.isPending ? 'Deleting...' : 'Delete my account'}
        </Button>

        {remove.isError && (
          <p role="alert" className="text-sm text-destructive">
            {remove.error instanceof Error
              ? remove.error.message
              : 'Could not delete the account'}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
