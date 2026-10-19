'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { AdminUserAction } from '@/lib/account'
import { apiService } from '@/services/api'

const DONE: Record<AdminUserAction, string> = {
  'revoke-sessions': 'Signed out on every device.',
  disable: 'Account disabled.',
  enable: 'Account enabled.',
}

// The admin's account actions (ADR-062 Decisions 4-6): sign the user out
// everywhere, disable or enable them, delete them. A stolen session calls
// for signing out, abuse for disabling; deleting is for test accounts and
// erasure requests.
export default function AccountActions({
  userId,
  email,
  status,
  onChanged,
}: {
  userId: string
  email: string
  status: string
  onChanged: () => void
}) {
  const router = useRouter()
  const [resetTrial, setResetTrial] = useState(false)
  const disabled = status === 'disabled'

  const act = useMutation({
    mutationFn: async (action: AdminUserAction) => {
      const resp = await apiService.adminUserAction(userId, action)
      if (!resp.success) throw new Error(resp.error || 'The action failed')
      return action
    },
    onSuccess: () => onChanged(),
  })

  const remove = useMutation({
    mutationFn: async () => {
      const resp = await apiService.adminDeleteUser(userId, { resetTrial })
      if (!resp.success)
        throw new Error(resp.error || 'Could not delete the account')
    },
    onSuccess: () => router.push('/admin/users'),
  })

  const busy = act.isPending || remove.isPending
  const error = act.error ?? remove.error

  const confirmThen = (question: string, run: () => void) => {
    if (window.confirm(question)) run()
  }

  return (
    <div className="space-y-4">
      <p className="flex items-center gap-2 text-sm">
        Status
        {disabled ? (
          <Badge variant="destructive">Disabled</Badge>
        ) : (
          <Badge variant="outline">Active</Badge>
        )}
      </p>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => act.mutate('revoke-sessions')}
        >
          Sign out everywhere
        </Button>
        {disabled ? (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => act.mutate('enable')}
          >
            Enable account
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() =>
              confirmThen(
                `Disable ${email}? They are signed out and cannot sign in until enabled.`,
                () => act.mutate('disable')
              )
            }
          >
            Disable account
          </Button>
        )}
      </div>

      <div className="space-y-2 border-t pt-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={resetTrial}
            onChange={(e) => setResetTrial(e.target.checked)}
            disabled={busy}
          />
          Allow the trial again
          <span className="text-muted-foreground">(test accounts only)</span>
        </label>
        <Button
          variant="destructive"
          size="sm"
          disabled={busy}
          onClick={() =>
            confirmThen(
              `Delete ${email} for good? Their data and their Clerk user are removed; the ledger stays.`,
              () => remove.mutate()
            )
          }
        >
          Delete account
        </Button>
      </div>

      {act.isSuccess && !busy && (
        <p className="text-sm text-muted-foreground">{DONE[act.data]}</p>
      )}
      {error && !busy && (
        <p role="alert" className="text-sm text-destructive">
          {error instanceof Error ? error.message : 'The action failed'}
        </p>
      )}
    </div>
  )
}
