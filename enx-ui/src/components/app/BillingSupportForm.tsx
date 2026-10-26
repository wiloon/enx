'use client'

import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  BILLING_SUPPORT_MAX_LENGTH,
  BILLING_SUPPORT_NEAR_LIMIT,
  supportMessageStatus,
  type BillingSupportAnswer,
} from '@/lib/billingSupport'
import { cn } from '@/lib/utils'
import { apiService } from '@/services/api'

// Billing-support entry for a blocked subscription (#297). The server keeps
// the first request, so the answer is the same for a repeated send. No page
// mounts it yet.
export default function BillingSupportForm({
  subscriptionId,
}: {
  subscriptionId: string
}) {
  const [text, setText] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [answer, setAnswer] = useState<BillingSupportAnswer | null>(null)
  // State lags a click; the ref stops a second one in the same tick.
  const inFlight = useRef(false)

  const { length, blank, overLimit } = supportMessageStatus(text)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (inFlight.current || blank || overLimit) return
    inFlight.current = true
    setPending(true)
    setError(null)
    try {
      const resp = await apiService.submitBillingSupport(subscriptionId, text)
      if (resp.success && resp.data) {
        setAnswer(resp.data)
      } else {
        setError(resp.error || 'Your message could not be sent.')
      }
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }

  if (answer) {
    return (
      <div className="space-y-2 text-sm">
        <p>{answer.message}</p>
        <p className="whitespace-pre-wrap break-words rounded-md border border-input px-3 py-2">
          {answer.supportRequest.message}
        </p>
        <p className="text-xs text-muted-foreground">
          Sent{' '}
          <time dateTime={answer.supportRequest.sentAt}>
            {new Date(answer.supportRequest.sentAt).toLocaleString('en-US', {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
          </time>
        </p>
      </div>
    )
  }

  return (
    <form className="space-y-3" onSubmit={submit}>
      <Label htmlFor="billing-support-message">Message to support</Label>
      <div className="rounded-xl border bg-card shadow-xs focus-within:ring-2 focus-within:ring-ring">
        <textarea
          id="billing-support-message"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={pending}
          placeholder="Tell us what you need help with."
          className="field-sizing-content max-h-[60vh] min-h-32 w-full resize-none overflow-y-auto border-0 bg-transparent px-3 py-2 text-base outline-none"
        />
        <div className="flex flex-wrap items-center justify-end gap-3 px-3 pb-3">
          {length >= BILLING_SUPPORT_NEAR_LIMIT && (
            <span
              className={cn(
                'text-xs',
                overLimit ? 'text-destructive' : 'text-muted-foreground'
              )}
            >
              {length.toLocaleString('en-US')} /{' '}
              {BILLING_SUPPORT_MAX_LENGTH.toLocaleString('en-US')} characters
            </span>
          )}
          <Button
            variant="brand"
            type="submit"
            disabled={blank || overLimit || pending}
          >
            {pending ? 'Sending...' : 'Send message'}
          </Button>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  )
}
