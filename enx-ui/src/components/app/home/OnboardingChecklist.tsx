'use client'

import Link from 'next/link'
import { Check, Circle } from 'lucide-react'
import { SITE } from '@/lib/site'
import { webStoreUrl } from '@/lib/enxExtension'
import type { ExtensionStatus } from '@/hooks/useExtensionStatus'

// What a brand-new user sees instead of the workbench (ADR-027 decision 1,
// form one): three steps, not a feature list. Step 3 stays unchecked here by
// construction -- this form only renders when the user has read nothing yet.
export default function OnboardingChecklist({
  status,
}: {
  status: ExtensionStatus
}) {
  const installed = status === 'installed'
  const storeUrl = webStoreUrl()

  return (
    <section className="rounded-lg border bg-card p-5 text-card-foreground">
      <h3 className="text-sm font-semibold">Get started in three steps</h3>
      <ol className="mt-4 space-y-4">
        <Step done={installed} index={1}>
          {installed ? (
            <span>{SITE.name} is installed</span>
          ) : storeUrl ? (
            <a
              href={storeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-brand underline-offset-4 hover:underline"
            >
              Add {SITE.name} to Chrome
            </a>
          ) : (
            <span>Add {SITE.name} to Chrome</span>
          )}
        </Step>

        <Step done={false} index={2}>
          <span>
            Open any English page and turn {SITE.name} on — words worth learning
            get underlined, and any word you click is explained.
          </span>
        </Step>

        <Step done={false} index={3}>
          <span>
            Finish your first article. No English page at hand?{' '}
            <Link
              href="/reader"
              className="font-medium text-brand underline-offset-4 hover:underline"
            >
              Paste some text instead
            </Link>
            .
          </span>
        </Step>
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
