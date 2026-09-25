import type { Metadata } from 'next'
import { LegalPage, List, Section, Term } from '@/components/site/LegalPage'
import { LEGAL } from '@/lib/legal'
import { SITE } from '@/lib/site'

// Refund Policy (LAUNCH-CHECKLIST §6.2). Stripe expects a merchant to
// publish one, and an unpublished refund rule is very hard to enforce in a
// dispute — the point of this page is that the rule existed *before* the
// charge, not after the complaint.
//
// The stance here is the one chosen on 2026-09-17: a no-questions window on
// a first subscription charge, unused credits always refundable, consumed
// credits not. The split matters — a subscription is access we can simply
// stop providing, whereas a consumed credit has already bought an AI call
// that was paid for at the time.
export const dynamic = 'force-static'

export const metadata: Metadata = {
  title: `Refund Policy — ${SITE.name}`,
  description: `When ${SITE.name} gives your money back, and how to ask.`,
}

export default function RefundPolicyPage() {
  return (
    <LegalPage
      title="Refund Policy"
      intro={`If ${SITE.name} isn't working out for you, we would rather give you your money back than keep it. Here are the rules, written down in advance so you can hold us to them.`}
      locale="en"
      enHref="/refund"
    >
      <Section heading="Subscriptions">
        <p>
          Your <Term>first charge on a new subscription</Term> can be refunded
          in full within <Term>{LEGAL.subscriptionRefundDays} days</Term>, for
          any reason. You do not have to explain, and we will not ask you to
          justify it.
        </p>
        <p>
          After that window, a subscription period that has started is not
          refunded, but you can cancel at any time to stop the next renewal.
          Cancelling leaves your access running until the end of the period you
          have already paid for — you never lose time you paid for.
        </p>
        <p>
          Two exceptions where we will refund outside the window, without you
          having to argue for it:
        </p>
        <List
          items={[
            <>
              <Term>A renewal you did not expect.</Term> If you were charged for
              a renewal you meant to cancel and you have not used the service in
              that period, write to us and we will refund it.
            </>,
            <>
              <Term>Extended downtime.</Term> If {SITE.name} is unavailable for
              a significant part of a period you paid for, we will refund that
              part.
            </>,
          ]}
        />
      </Section>

      <Section heading="Credits">
        <p>
          <Term>Unused credits can be refunded at any time</Term>, at the price
          you paid for them. Ask and we will refund the balance you have not
          spent.
        </p>
        <p>
          <Term>Credits you have already spent are not refundable.</Term> Each
          one paid for an AI call that was made and charged to us at the time,
          so there is nothing left to return. You can always see where your
          credits went on the Billing page.
        </p>
        <p>
          If credits were consumed by something that clearly went wrong on our
          side — a failed request that still charged you, a duplicate call, a
          bug — that is not a refund question. Tell us and we will put the
          credits back.
        </p>
      </Section>

      <Section heading="Your rights as a consumer">
        <p>
          Depending on where you live, you may have a statutory right to cancel
          a purchase of digital services within a set period. This policy does
          not replace that right, and nothing here takes it away. Where your
          local law gives you more than this page does, your local law wins.
        </p>
      </Section>

      <Section heading="How to ask">
        <p>
          Email <Term>{LEGAL.contactEmail}</Term> from the address on your
          account, and tell us what you would like refunded. You do not need a
          form or a reason.
        </p>
        <p>
          We will reply within{' '}
          <Term>{LEGAL.refundResponseDays} business days</Term>. Approved
          refunds go back to the original payment method through Stripe; how
          long it then takes to appear is up to your bank, usually 5–10 business
          days.
        </p>
      </Section>

      <Section heading="Chargebacks">
        <p>
          If something looks wrong on your statement, please write to us before
          disputing the charge with your bank — we can almost always sort it out
          faster, and a chargeback automatically suspends the account while the
          bank investigates.
        </p>
      </Section>

      <Section heading="Abuse">
        <p>
          We may decline a refund where the account has breached the{' '}
          <a
            href="/terms"
            className="underline underline-offset-4 hover:text-foreground"
          >
            Terms of Service
          </a>
          , or where the pattern is plainly an attempt to use the service for
          free — repeatedly subscribing, consuming credits, and refunding. This
          is not aimed at anyone changing their mind; it is aimed at the case
          that is obvious when you see it.
        </p>
      </Section>

      <Section heading="Contact">
        <p>
          {SITE.name} is operated by <Term>{LEGAL.operatorName}</Term> —{' '}
          <Term>{LEGAL.contactEmail}</Term>
        </p>
      </Section>
    </LegalPage>
  )
}
