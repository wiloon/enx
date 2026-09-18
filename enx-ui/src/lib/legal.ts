// Legal-page constants (LAUNCH-CHECKLIST §6.2). Same idea as site.ts: every
// value that a lawyer, a Chrome Web Store reviewer or a Stripe reviewer will
// check lives HERE, so launch prep is a single-file review instead of a grep
// through three pages of prose.
//
// ⚠️ Every `TODO` below must be a real value before the site goes public.
// A privacy policy naming the wrong entity, or no entity, is worse than
// none: it is a representation to users and to two review processes.

export const LEGAL = {
  // --- The entity behind the service -------------------------------------
  // GDPR calls this the "controller"; Stripe calls it the merchant of
  // record. It must match the name on the Stripe account and the Chrome Web
  // Store developer account, or both reviews raise it.
  companyName: '星钺（大连）科技有限公司',
  /** English rendering, for the English-language pages. */
  companyNameEn: 'Xingyue (Dalian) Technology Co., Ltd.',
  companyAddress:
    '辽宁省大连市高新技术产业园区闻涛街41号21层2号 (Room 2, Floor 21, No. 41 Wentao Street, Hi-Tech Industrial Park, Dalian, Liaoning, China)',
  /** Law governing the Terms. */
  jurisdiction: "the People's Republic of China",
  /** Court venue named in the Terms. */
  courtVenue: 'Dalian, Liaoning',
  /** Company registration date, cited in the Terms' contact block. */
  incorporatedOn: '2026-06-10',

  // --- Contact ------------------------------------------------------------
  // On catglish.com (LAUNCH-CHECKLIST §0.1). ⚠️ Both mailboxes must exist
  // and be monitored before launch: Chrome Web Store lists the contact
  // address publicly, and this is where deletion and refund requests
  // arrive. Cloudflare Email Routing is enough.
  contactEmail: 'support@catglish.com',
  privacyEmail: 'privacy@catglish.com',

  // --- Where the data physically lives ------------------------------------
  // Required disclosure. Users' data sits on this server, so name the actual
  // region, not "the cloud".
  hostingProvider: 'Amazon Web Services (AWS)',
  // LAUNCH-CHECKLIST §0.2: AWS EC2 ap-northeast-1, single instance.
  hostingRegion: 'ap-northeast-1 (Tokyo, Japan)',

  // --- Dates --------------------------------------------------------------
  // "Last updated" is load-bearing: a policy with no date cannot be shown to
  // have been in force when a given user signed up.
  effectiveDate: 'TODO: YYYY-MM-DD',

  // --- Commercial terms referenced by the pages ---------------------------
  /** No-questions-asked window for a first subscription charge. */
  subscriptionRefundDays: 7,
  /** Target turnaround for a refund decision, in business days. */
  refundResponseDays: 5,
} as const

/**
 * The AI provider that user-selected text is sent to IN PRODUCTION.
 *
 * Named explicitly, and in the policy itself, because "a third-party AI
 * provider" is not a disclosure -- where the text goes is exactly what a
 * reader of a privacy policy is trying to find out.
 *
 * ⚠️ `enx-api/aitranslate/` also ships kimi, minimax and deepseek providers,
 * selected by `SENTENCE_TRANSLATE_PROVIDER`. Those exist for homelab and for
 * a possible future mainland-China deployment; production runs Bedrock, so
 * production is what this policy describes. If production is ever switched
 * to one of the others, THIS CONSTANT AND THE SUB-PROCESSOR LIST MUST CHANGE
 * IN THE SAME COMMIT -- a policy naming the wrong recipient of user text is
 * a false statement, not a stale doc.
 */
export const AI_PROVIDER = {
  name: 'Amazon Bedrock',
  entity: 'Amazon Web Services, Inc.',
  /** The model family served through Bedrock. */
  model: "Anthropic's Claude",
  privacyUrl: 'https://aws.amazon.com/privacy/',
} as const

/**
 * Every third party that receives personal data, and what it gets.
 *
 * GDPR calls these sub-processors and requires them listed; Chrome Web Store
 * asks the same question in different words. Keeping the list in code means
 * adding an integration puts this file in the diff.
 */
export const SUBPROCESSORS = [
  {
    name: 'Clerk',
    purpose: 'Sign-in and account management',
    data: 'Email address, authentication events',
    location: 'United States',
    url: 'https://clerk.com/legal/privacy',
  },
  {
    name: 'Stripe',
    purpose: 'Payments and subscriptions',
    data: 'Email address, payment details, billing history',
    location: 'United States',
    url: 'https://stripe.com/privacy',
  },
  {
    name: `${AI_PROVIDER.name} (${AI_PROVIDER.model})`,
    purpose: 'Sentence and in-context translation',
    data: 'The sentence or phrase you select, and the word you clicked',
    location: LEGAL.hostingRegion,
    url: AI_PROVIDER.privacyUrl,
  },
  {
    name: 'Sentry',
    purpose: 'Crash and error reporting',
    data: 'Error messages, stack traces, browser and version information',
    location: 'United States',
    url: 'https://sentry.io/privacy/',
  },
  {
    name: 'Amazon Web Services',
    purpose: 'Hosting',
    data: 'All data described in this policy',
    location: LEGAL.hostingRegion,
    url: 'https://aws.amazon.com/privacy/',
  },
] as const
