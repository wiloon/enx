import type { Metadata } from 'next'
import Link from 'next/link'
import { HELP_GUIDES } from '@/lib/help'
import { SITE } from '@/lib/site'

export const metadata: Metadata = { title: `Help — ${SITE.name}` }

export default function HelpPage() {
  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight">Help</h1>
      <p className="text-lg text-muted-foreground">
        Install {SITE.name} and start reading English with a little help.
      </p>
      {/* Shows whether the extension is installed and pinned (ADR-047 #873). */}
      <p className="text-muted-foreground">
        Something not working?{' '}
        <Link
          href="/welcome"
          className="font-medium text-brand hover:underline active:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
        >
          Check setup
        </Link>
      </p>
      <section aria-labelledby="getting-started" className="space-y-5">
        <h2 id="getting-started" className="text-xl font-semibold">
          Getting started
        </h2>
        {HELP_GUIDES.map((guide) => (
          <div
            key={guide.href}
            className="space-y-1 border-b border-border pb-5"
          >
            <Link
              href={guide.href}
              className="text-lg font-medium text-brand hover:underline active:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
            >
              {guide.title}
            </Link>
            <p className="text-muted-foreground">{guide.description}</p>
          </div>
        ))}
      </section>
    </>
  )
}
