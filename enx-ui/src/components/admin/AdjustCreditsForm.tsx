'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { deductWarning, parseAdjustment } from '@/lib/adminUsers'
import { apiService } from '@/services/api'

type Direction = 'grant' | 'deduct'

// Admin grant and deduction for one user (ADR-049 Decisions 2-3). Both go
// through the top-up pool and keep the reason on the ledger row. A deduction
// asks first, and says so when it would leave the pool below zero. The
// request names the user by their enx ID; the email is only shown.
export default function AdjustCreditsForm({
  userId,
  email,
  topupBalance,
  onAdjusted,
}: {
  userId: string
  email: string
  topupBalance: number
  onAdjusted: () => void
}) {
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<number | null>(null)

  const mutation = useMutation({
    mutationFn: async (vars: {
      direction: Direction
      amount: number
      reason: string
    }) => {
      const resp = await apiService.adminAdjustCredits(vars.direction, {
        userId,
        amount: vars.amount,
        reason: vars.reason,
      })
      if (resp.success && resp.data) return resp.data
      throw new Error(resp.error || 'Failed to update credits')
    },
    onSuccess: (data, vars) => {
      const verb = vars.direction === 'grant' ? 'Granted' : 'Deducted'
      setDone(`${verb} ${vars.amount} credits. New balance: ${data.balance}.`)
      setAmount('')
      setReason('')
      setConfirming(null)
      onAdjusted()
    },
    onError: (err) => {
      setError((err as Error).message)
      setConfirming(null)
    },
  })

  const submit = (direction: Direction) => {
    setDone(null)
    const parsed = parseAdjustment(amount, reason)
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    setError(null)
    if (direction === 'deduct' && confirming === null) {
      setConfirming(parsed.amount)
      return
    }
    mutation.mutate({ direction, amount: parsed.amount, reason: parsed.reason })
  }

  const warning =
    confirming === null ? null : deductWarning(topupBalance, confirming)

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        submit('grant')
      }}
    >
      <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
        <div className="space-y-1.5">
          <Label htmlFor="adjust-amount">Credits</Label>
          <Input
            id="adjust-amount"
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={amount}
            disabled={confirming !== null}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="adjust-reason">Reason</Label>
          <Input
            id="adjust-reason"
            placeholder="Kept on the ledger, e.g. support comp for outage"
            value={reason}
            disabled={confirming !== null}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {done && (
        <p role="status" className="text-sm text-muted-foreground">
          {done}
        </p>
      )}

      {confirming === null ? (
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={mutation.isPending}>
            Grant credits
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={mutation.isPending}
            onClick={() => submit('deduct')}
          >
            Deduct credits
          </Button>
        </div>
      ) : (
        <div className="space-y-3 rounded-md border border-destructive/40 bg-destructive/5 p-3">
          <p className="text-sm font-medium">
            Deduct {confirming} credits from {email}?
          </p>
          {warning && <p className="text-sm text-destructive">{warning}</p>}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="destructive"
              disabled={mutation.isPending}
              onClick={() => submit('deduct')}
            >
              Confirm deduction
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => setConfirming(null)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </form>
  )
}
