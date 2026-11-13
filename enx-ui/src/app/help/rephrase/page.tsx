import type { Metadata } from 'next'
import Link from 'next/link'
import { SITE } from '@/lib/site'

export const metadata: Metadata = { title: `Rephrase — ${SITE.name}` }

// Rephrase is a writing tool, so it is explained here rather than on the
// reading-focused landing page.
export default function RephraseHelpPage() {
  return (
    <article className="space-y-8">
      <header className="space-y-3">
        <h1 className="text-3xl font-bold tracking-tight">
          Rephrase into idiomatic English
        </h1>
        <p className="text-lg text-muted-foreground">
          Writing to an English-speaking teammate? Rephrase turns Chinese or
          rough English into the way a colleague would actually say it.
        </p>
      </header>
      <section aria-labelledby="use" className="space-y-4">
        <h2 id="use" className="text-xl font-semibold">
          How to use it
        </h2>
        <ol className="list-decimal space-y-3 pl-5">
          <li>
            Sign in and <Link href="/rephrase">Open Rephrase</Link> from the
            app’s sidebar.
          </li>
          <li>
            Type what you want to say in Chinese, mixed Chinese and English, or
            rough English, one sentence at a time, up to 200 characters.
          </li>
          <li>
            Press <strong>Enter</strong> or click <strong>Rephrase</strong>. Use{' '}
            <strong>Shift+Enter</strong> for a new line and <strong>Esc</strong>{' '}
            to clear.
          </li>
        </ol>
      </section>
      <section aria-labelledby="result" className="space-y-4">
        <h2 id="result" className="text-xl font-semibold">
          What you get back
        </h2>
        <p>
          The most natural wording comes first, with one or two alternatives in
          a different tone, such as more formal for email or more casual for
          chat. Short notes explain the word and tone choices. Each line has a
          Copy button.
        </p>
        <p className="text-muted-foreground">
          Rephrase only re-expresses what you wrote; it does not add details.
          Each rephrase uses AI credits, and a failed request is never charged.
        </p>
      </section>
    </article>
  )
}
