'use client'

import Link from 'next/link'
import { Check, Circle } from 'lucide-react'
import { onboardingSteps } from '@/lib/onboarding'
import type { ExtensionStatus } from '@/hooks/useExtensionStatus'

// What a brand-new user sees instead of the workbench (ADR-027 decision 1,
// form one). The same steps as /welcome (ADR-047 Decision 6), shortened:
// Home is behind sign-in, so that step is always done and left out, and the
// pin step is left to /welcome, the only page that asks the extension about
// it. Every open step leads to /welcome, where it is done.
export default function OnboardingChecklist({
  status,
}: {
  status: ExtensionStatus
}) {
  const { steps } = onboardingSteps({
    installed: status !== 'not-installed',
    signedIn: true,
    isOnToolbar: false,
    pinSkipped: false,
    learningEnabled: false,
    hasLookedUp: false,
  })

  return (
    <section className="rounded-lg border bg-card p-5 text-card-foreground">
      <h3 className="text-sm font-semibold">Get started</h3>
      <ol className="mt-4 space-y-4">
        {steps
          .filter((step) => step.id !== 'sign-in' && step.id !== 'pin')
          .map((step, i) => (
            <Step key={step.id} done={step.status === 'done'} index={i + 1}>
              {step.status === 'done' ? (
                <span>{step.title}</span>
              ) : (
                <Link
                  href="/welcome"
                  className="font-medium text-brand underline-offset-4 hover:underline"
                >
                  {step.title}
                </Link>
              )}
            </Step>
          ))}
      </ol>
    </section>
  )
}

function Step({
  done,
  index,
  children,
}: {
  done: boolean
  index: number
  children: React.ReactNode
}) {
  return (
    <li className="flex gap-3 text-sm">
      <span
        className="mt-0.5 shrink-0"
        aria-label={done ? 'Done' : `Step ${index}`}
      >
        {done ? (
          <Check aria-hidden className="size-4 text-brand" />
        ) : (
          <Circle aria-hidden className="size-4 text-muted-foreground" />
        )}
      </span>
      <span className={done ? 'text-muted-foreground' : undefined}>
        {children}
      </span>
    </li>
  )
}
