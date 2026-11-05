'use client'

import Link from 'next/link'
import { ArrowRight, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { homeChecklistSteps } from '@/lib/onboarding'
import { SITE } from '@/lib/site'
import type { ExtensionStatus } from '@/hooks/useExtensionStatus'

// What a brand-new user sees instead of the workbench (ADR-027 decision 1,
// form one). The same steps as /welcome, shortened (ADR-047 Decision 6).
// The steps are done on /welcome, so the card has one way there: its button.
export default function OnboardingChecklist({
  status,
}: {
  status: ExtensionStatus
}) {
  // Until the extension check answers, the install step would flash in or out.
  if (status === 'unknown') return null
  const steps = homeChecklistSteps(status === 'installed')
  const done = steps.filter((step) => step.status === 'done').length

  return (
    <section className="rounded-lg border bg-card p-5 text-card-foreground">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-base font-semibold">Try {SITE.name} in 1 minute</h3>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {done} of {steps.length}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Read a short sample article and look up your first word.
      </p>

      <ol role="list" className="mt-4 space-y-3">
        {steps.map((step, i) => {
          const isDone = step.status === 'done'
          return (
            <li key={step.id} className="flex items-center gap-3 text-sm">
              <span
                aria-hidden
                className={
                  isDone
                    ? 'flex size-6 shrink-0 items-center justify-center rounded-full bg-brand text-brand-foreground'
                    : 'flex size-6 shrink-0 items-center justify-center rounded-full bg-brand/10 text-xs font-semibold text-brand'
                }
              >
                {isDone ? <Check className="size-3.5" /> : i + 1}
              </span>
              <span className={isDone ? 'text-muted-foreground' : undefined}>
                {isDone && <span className="sr-only">Done: </span>}
                {step.title}
              </span>
            </li>
          )
        })}
      </ol>

      <Button asChild variant="brand" className="mt-5">
        <Link href="/welcome">
          Start with a sample article
          <ArrowRight aria-hidden />
        </Link>
      </Button>
    </section>
  )
}
