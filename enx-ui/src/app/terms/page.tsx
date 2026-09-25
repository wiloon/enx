import type { Metadata } from 'next'
import { LegalPage, List, Section, Term } from '@/components/site/LegalPage'
import { LEGAL } from '@/lib/legal'
import { SITE } from '@/lib/site'

// Terms of Service (LAUNCH-CHECKLIST §6.2). Required by Stripe for a
// merchant account, and referenced from the Chrome Web Store listing.
//
// ⚠️ Drafted, not legal advice. The two clauses most worth a lawyer's eye
// are the limitation of liability (§11) and the governing-law clause (§13):
// both are jurisdiction-specific and both are the ones that matter if
// anything ever goes wrong.
export const dynamic = 'force-static'

export const metadata: Metadata = {
  title: `Terms of Service — ${SITE.name}`,
  description: `The terms you agree to when you use ${SITE.name}.`,
}

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      intro={`These terms are the agreement between you and ${LEGAL.operatorName}, the individual who runs ${SITE.name}. Using the service means you accept them.`}
      locale="en"
      enHref="/terms"
    >
      <Section heading="1. The service">
        <p>
          {SITE.name} is a browser extension and website that helps you read
          English: it highlights words worth learning, looks up definitions,
          translates sentences you select, and keeps a vocabulary list and
          reading statistics for you.
        </p>
        <p>
          It is run by <Term>one person</Term>, {LEGAL.operatorRole}, not by a
          company. Support is answered by that person, which means replies come
          when they come — see the response time in the{' '}
          <a
            href="/refund"
            className="underline underline-offset-4 hover:text-foreground"
          >
            Refund Policy
          </a>{' '}
          for the commitment that is actually made.
        </p>
        <p>
          We may change, add or remove features. If we discontinue a paid
          feature you are currently paying for, we will refund the unused
          portion.
        </p>
      </Section>

      <Section heading="2. Your account">
        <p>
          You need an account to use {SITE.name}. You are responsible for
          keeping access to it secure, and for what happens under it. Tell us at{' '}
          {LEGAL.contactEmail} if you believe someone else has access.
        </p>
        <p>
          One account is for one person. Sharing credentials, or using one
          account to serve multiple users, is not permitted.
        </p>
      </Section>

      <Section heading="3. Acceptable use">
        <p>You agree not to:</p>
        <List
          items={[
            'Use the service to break the law, or to infringe someone else’s rights',
            'Resell, redistribute or repackage the definitions, translations or other output as your own service',
            'Automate access in a way that goes beyond ordinary reading — scripted bulk translation, scraping our API, or running the extension against content programmatically',
            'Try to bypass usage limits, quotas or billing',
            'Interfere with the service, or attempt to access other users’ data',
          ]}
        />
        <p>
          We may suspend or close an account that does any of these. Where the
          breach is not deliberate, we will tell you first and give you a chance
          to stop.
        </p>
      </Section>

      <Section heading="4. Subscriptions">
        <p>
          Paid plans are billed in advance and <Term>renew automatically</Term>{' '}
          at the end of each period until you cancel. You can cancel at any time
          from the Billing page; cancelling stops the next renewal and leaves
          your access running until the end of the period you have already paid
          for.
        </p>
        <p>
          Prices are shown at checkout. If we change a price, the change applies
          from your next renewal and we will tell you in advance.
        </p>
      </Section>

      <Section heading="5. Credits">
        <p>
          AI features — sentence translation, in-context explanation and
          rephrasing — consume <Term>credits</Term>. Credits come with a
          subscription and can also be bought separately. They are consumed as
          you use those features, at the rates shown in the app.
        </p>
        <p>
          Credits have no cash value outside the service and cannot be
          transferred between accounts. Unused credits are refundable under our{' '}
          <a
            href="/refund"
            className="underline underline-offset-4 hover:text-foreground"
          >
            Refund Policy
          </a>
          ; consumed credits are not, because the underlying cost has already
          been incurred.
        </p>
      </Section>

      <Section heading="6. Refunds">
        <p>
          See the{' '}
          <a
            href="/refund"
            className="underline underline-offset-4 hover:text-foreground"
          >
            Refund Policy
          </a>
          , which forms part of these terms. In short: a first subscription
          charge can be refunded in full within {LEGAL.subscriptionRefundDays}{' '}
          days, and unused credits can be refunded at any time.
        </p>
      </Section>

      <Section heading="7. Accuracy — please read this one">
        <p>
          Definitions, translations and explanations are produced by
          dictionaries and by AI language models. They are{' '}
          <Term>frequently useful and sometimes wrong</Term>. An AI translation
          can be fluent and confident and still misrepresent the original.
        </p>
        <p>
          {SITE.name} is a learning aid. Do not rely on its output for anything
          where an error matters — legal documents, medical information,
          contracts, safety instructions, or any professional or official
          translation. For those, use a qualified human translator.
        </p>
      </Section>

      <Section heading="8. Content you read">
        <p>
          {SITE.name} works on web pages published by other people. We do not
          own, control, endorse or take responsibility for that content. Your
          use of it remains subject to whatever terms the site that published it
          sets.
        </p>
        <p>
          Text you paste into the Reader remains yours. You give us permission
          only to store and display it back to you, and to process it to provide
          the features you use. We delete it after 7 days automatically.
        </p>
      </Section>

      <Section heading="9. Our intellectual property">
        <p>
          The software, the site, the name {SITE.name} and its branding belong
          to {LEGAL.operatorName}. Nothing in these terms transfers any of that
          to you. You get a personal, non-exclusive, non-transferable right to
          use the service while your account is in good standing.
        </p>
      </Section>

      <Section heading="10. Availability">
        <p>
          We aim to keep {SITE.name} running, but we do not promise it will be
          uninterrupted or error-free. We may take it down for maintenance, and
          depend on third-party providers who may have outages of their own.
          Extended paid downtime is handled as a refund under the Refund Policy.
        </p>
      </Section>

      <Section heading="11. Limitation of liability">
        <p>
          To the extent the law allows, {LEGAL.operatorName} is not liable for
          indirect or consequential loss, lost profits, lost data, or losses
          arising from your reliance on a definition or translation. Our total
          liability to you for any claim is limited to what you paid us in the
          twelve months before the claim arose.
        </p>
        <p>
          Nothing here limits liability that cannot be limited by law —
          including, where it applies to you, your rights as a consumer.
        </p>
      </Section>

      <Section heading="12. Ending the agreement">
        <p>
          You can close your account at any time by writing to{' '}
          {LEGAL.contactEmail}. We may close or suspend an account that breaches
          these terms, or if we stop operating the service — in which case we
          will give notice and refund the unused portion of anything you have
          paid.
        </p>
      </Section>

      <Section heading="13. Governing law">
        <p>
          These terms are governed by the laws of {LEGAL.jurisdiction}, where
          the operator lives.
        </p>
        <p>
          If you are a consumer, this does not deprive you of the protection of
          mandatory rules in your own country of residence, and it does not
          limit any right you have to bring a complaint to a consumer protection
          authority where you live.
        </p>
      </Section>

      <Section heading="14. Changes">
        <p>
          We may update these terms. We will change the date at the top and, for
          a material change, tell you by email before it takes effect.
          Continuing to use {SITE.name} after that means you accept the new
          terms; if you do not, close your account and we will refund the unused
          portion of your current period.
        </p>
      </Section>

      <Section heading="15. Contact">
        <p>
          {SITE.name} is operated by <Term>{LEGAL.operatorName}</Term>,{' '}
          {LEGAL.operatorRole} in {LEGAL.jurisdiction}.
        </p>
        <p>
          <Term>{LEGAL.contactEmail}</Term>
        </p>
      </Section>
    </LegalPage>
  )
}
