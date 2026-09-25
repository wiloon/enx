import type { Metadata } from 'next'
import { LegalPage, List, Section, Term } from '@/components/site/LegalPage'
import { AI_PROVIDER, LEGAL, SUBPROCESSORS } from '@/lib/legal'
import { SITE } from '@/lib/site'

// Privacy Policy (LAUNCH-CHECKLIST §6.2). Required independently by the
// Chrome Web Store (an extension that handles personal data must link one)
// and by Stripe.
//
// ⚠️ This is a drafted policy, not legal advice, and it is only true as long
// as it matches the code. Every claim below was written against a specific
// table or call site; if one of those changes, this page is the diff that
// has to change with it. The load-bearing ones:
//   - "we never store the address or title of a page"  -> stats/daily.go,
//     which has no such column, and ADR-028 Decision 10
//   - the sub-processor list                           -> lib/legal.ts
//   - the AI provider named                            -> the deployment's
//     SENTENCE_TRANSLATE_PROVIDER
export const dynamic = 'force-static'

export const metadata: Metadata = {
  title: `Privacy Policy — ${SITE.name}`,
  description: `How ${SITE.name} handles your data: what is collected, what is deliberately not collected, and who else receives it.`,
}

export default function PrivacyPolicyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro={`${SITE.name} is a reading tool, which means it sees what you read. This page explains exactly how much of that we keep — and how much we deliberately throw away.`}
      locale="en"
      enHref="/privacy"
    >
      <Section heading="Who we are">
        <p>
          {SITE.name} is built and run by <Term>{LEGAL.operatorName}</Term>,{' '}
          {LEGAL.operatorRole} based in {LEGAL.jurisdiction}. There is no
          company and no team — when this page says &ldquo;we&rdquo;, it means
          one person.
        </p>
        <p>
          That is worth knowing for a practical reason: your data is handled by
          one individual and the providers listed below, and nobody else. For
          anything in this policy, including a request to delete your data,
          write to <Term>{LEGAL.privacyEmail}</Term>.
        </p>
      </Section>

      <Section heading="The short version">
        <List
          items={[
            <>
              We store <Term>the words you look up</Term>, because that is the
              vocabulary list — it is the product.
            </>,
            <>
              We store <Term>daily totals</Term> of how much you read. We do not
              store <Term>which pages</Term> you read them on.
            </>,
            <>
              When you ask for a sentence translation, that sentence is sent to
              an AI model run by <Term>{AI_PROVIDER.name}</Term>, in{' '}
              {AI_PROVIDER.location}. We do not keep a copy.
            </>,
            <>
              We do not sell your data, and we do not use it for advertising.
            </>,
          ]}
        />
      </Section>

      <Section heading="What the extension does on the pages you visit">
        <p>
          The extension only acts on a page when <Term>you turn it on</Term> for
          that page, from the toolbar button or the right-click menu. It is not
          running in the background on every site you open.
        </p>
        <p>
          When you do turn it on, it reads the article text{' '}
          <Term>in your browser</Term> to find the English words on the page and
          underline the ones worth learning. That text is processed locally.
          What leaves your browser is limited to:
        </p>
        <List
          items={[
            <>
              the list of <Term>individual words</Term> on the page, so we can
              return their definitions and your review status for each;
            </>,
            <>
              a word you <Term>click</Term>, to look it up;
            </>,
            <>
              a sentence or phrase you <Term>select</Term> and ask to have
              translated.
            </>,
          ]}
        />
        <p>
          The extension requests permission for all websites because you may
          want to read English on any of them, and it cannot know in advance
          which. That permission is not a statement that we collect anything
          from those sites. The address, title and full text of a page are never
          sent to our servers and never stored.
        </p>
      </Section>

      <Section heading="What we store">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-foreground">
              <tr className="border-b border-border">
                <th className="py-2 pr-4 font-medium">Data</th>
                <th className="py-2 pr-4 font-medium">Why</th>
                <th className="py-2 font-medium">Kept for</th>
              </tr>
            </thead>
            <tbody>
              {[
                [
                  'Email address and account identifier',
                  'To sign you in and to contact you about your account',
                  'As long as your account exists',
                ],
                [
                  'The words you look up, how many times, and whether you have marked each one as known',
                  'This is your vocabulary list and review schedule',
                  'As long as your account exists',
                ],
                [
                  'Text you paste into the Reader',
                  'So you can come back to it',
                  '7 days, then deleted automatically (most recent 50 documents)',
                ],
                [
                  'Daily totals: words read, articles read, words looked up',
                  'The charts on your Reading Stats page',
                  'As long as your account exists',
                ],
                [
                  'The address of a page Catglish could not read — only if you press "Send report" in the extension',
                  'So we can fix support for that page',
                  '90 days, then deleted automatically (most recent 50 reports)',
                ],
                [
                  'Subscription status, credit balance, and a record of each AI call (which feature, how much it cost)',
                  'Billing, and showing you where your credits went',
                  'As long as your account exists, plus any period required for tax and accounting records',
                ],
                [
                  'Crash reports and error diagnostics',
                  'To find and fix bugs',
                  "Per Sentry's retention period",
                ],
              ].map(([data, why, kept]) => (
                <tr key={data} className="border-b border-border/60 align-top">
                  <td className="py-3 pr-4">{data}</td>
                  <td className="py-3 pr-4">{why}</td>
                  <td className="py-3">{kept}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section heading="What we deliberately do not store">
        <p>
          The reading statistics are built from day-level totals only. Apart
          from the one exception described below, there is no column anywhere in
          our database for any of the following, so there is nothing to hand
          over, leak or subpoena:
        </p>
        <List
          items={[
            'The address (URL) of any page you read',
            'The domain or title of any page you read',
            'The text of any page you read',
            'The time of day you read anything — totals are per calendar day, nothing finer',
            'Your location, or any device fingerprint',
          ]}
        />
        <p>
          The one exception is a report you send yourself. When Catglish cannot
          process a page, the extension offers to send us that page&apos;s
          address. It shows you exactly what would be sent, and sends nothing
          unless you press &quot;Send report&quot;. The address is cut down to
          the site and path — no query string, no fragment, no login details —
          and parts of the path that look like personal identifiers, such as an
          email address or a long token, are replaced with a placeholder. We
          keep it, together with the reason the page failed and your account
          identifier, for 90 days and for no more than your 50 most recent
          reports. It is used only to fix support for that page — never for
          statistics or profiling.
        </p>
        <p>
          Apart from a report you send, which article you were reading is
          something your own browser knows and our servers never learn.
        </p>
      </Section>

      <Section heading="Sentence translation and AI">
        <p>
          When you select a sentence or phrase and ask for a translation, that
          text — and the word you clicked, if any — is sent to{' '}
          <Term>{AI_PROVIDER.model}</Term>, run by{' '}
          <Term>{AI_PROVIDER.name}</Term> ({AI_PROVIDER.entity}), in{' '}
          <Term>{AI_PROVIDER.location}</Term>. This happens only for text you
          explicitly select; it does not happen as you read.
        </p>
        <p>
          We do not store the sentence or the translation on our servers. We do
          store a billing record that the call happened, what it cost, and when
          — not what it contained. {AI_PROVIDER.name}&apos;s handling of the
          text is governed by{' '}
          <a
            href={AI_PROVIDER.privacyUrl}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-4 hover:text-foreground"
          >
            their privacy policy
          </a>
          . If you would rather no text left your browser at all, do not use the
          sentence-translation features; word lookup and highlighting do not
          involve an AI provider.
        </p>
      </Section>

      <Section heading="Who else receives your data">
        <p>
          We use the following providers. Each receives only what it needs to do
          its job.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-foreground">
              <tr className="border-b border-border">
                <th className="py-2 pr-4 font-medium">Provider</th>
                <th className="py-2 pr-4 font-medium">What it receives</th>
                <th className="py-2 font-medium">Where</th>
              </tr>
            </thead>
            <tbody>
              {SUBPROCESSORS.map((p) => (
                <tr
                  key={p.name}
                  className="border-b border-border/60 align-top"
                >
                  <td className="py-3 pr-4">
                    <a
                      href={p.url}
                      target="_blank"
                      rel="noreferrer"
                      className="underline underline-offset-4 hover:text-foreground"
                    >
                      {p.name}
                    </a>
                    <div className="text-xs">{p.purpose}</div>
                  </td>
                  <td className="py-3 pr-4">{p.data}</td>
                  <td className="py-3">{p.location}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          We do not sell personal data, and we do not share it with advertisers
          or data brokers. We may disclose data if we are legally required to,
          or to protect the service against abuse.
        </p>
      </Section>

      <Section heading="Payments">
        <p>
          Payments are processed by <Term>Stripe</Term>. Your card number never
          reaches our servers — Stripe handles it and gives us back only a
          customer reference, your subscription status, and the last four digits
          for display. Refunds are covered by our{' '}
          <a
            href="/refund"
            className="underline underline-offset-4 hover:text-foreground"
          >
            Refund Policy
          </a>
          .
        </p>
      </Section>

      <Section heading="Where your data is stored">
        <p>
          Our servers and database run on {LEGAL.hostingProvider} in{' '}
          <Term>{LEGAL.hostingRegion}</Term>. The providers listed above operate
          in their own regions, so using {SITE.name} involves your data being
          processed in more than one country.
        </p>
      </Section>

      <Section heading="Your choices and your rights">
        <List
          items={[
            <>
              <Term>See your data.</Term> Your vocabulary list, statistics and
              billing history are all visible in the app.
            </>,
            <>
              <Term>Delete your data.</Term> Email {LEGAL.privacyEmail} and we
              will delete your account and everything attached to it. Billing
              records may be retained where tax law requires it.
            </>,
            <>
              <Term>Export your data.</Term> Ask at {LEGAL.privacyEmail} and we
              will send you a machine-readable copy.
            </>,
            <>
              <Term>Stop the extension.</Term> It only acts on pages you turn it
              on for. Removing it from your browser stops all local processing
              immediately.
            </>,
          ]}
        />
        <p>
          Depending on where you live, you may have additional rights —
          including to correct your data, to object to processing, or to
          complain to a data protection authority. Write to {LEGAL.privacyEmail}{' '}
          and we will honour those requests regardless of where you are.
        </p>
      </Section>

      <Section heading="Children">
        <p>
          {SITE.name} is not directed at children under 14, and we do not
          knowingly collect their data. If you believe a child has created an
          account, contact {LEGAL.privacyEmail} and we will remove it.
        </p>
      </Section>

      <Section heading="Changes to this policy">
        <p>
          If we change what we collect or who receives it, we will update this
          page and the date at the top, and — for a change that materially
          affects you — tell you by email before it takes effect.
        </p>
      </Section>

      <Section heading="Contact">
        <p>
          Privacy questions and data requests: <Term>{LEGAL.privacyEmail}</Term>
          . Everything else: <Term>{LEGAL.contactEmail}</Term>.
        </p>
      </Section>
    </LegalPage>
  )
}
