// Legal-page constants (LAUNCH-CHECKLIST §6.2). Same idea as site.ts: every
// value that a lawyer, a Chrome Web Store reviewer or a Stripe reviewer will
// check lives HERE, so launch prep is a single-file review instead of a grep
// through three pages of prose.
//
// ⚠️ Every `TODO` below must be a real value before the site goes public.
// A privacy policy naming the wrong entity, or no entity, is worse than
// none: it is a representation to users and to two review processes.

export const LEGAL = {
  // --- Who operates the service -------------------------------------------
  // Catglish is run by ONE PERSON, not a company (decided 2026-09-18). That
  // is a legitimate and common way to publish a browser extension, and the
  // pages say so plainly rather than using a corporate "we" that implies an
  // entity that does not exist.
  //
  // GDPR would call this person the "controller"; Stripe calls them the
  // merchant of record. The name here must match the Chrome Web Store
  // developer account and the payment account, or both reviews raise it.
  // Exactly as it appears on the passport, given-name first and in caps.
  // Matching the travel document is what keeps this consistent with the
  // Chrome Web Store developer account and the payment account; a mismatch
  // is something either review can stop on.
  operatorName: 'YUE WANG',
  /** Filled into sentences like "operated by {operatorName}, {operatorRole}". */
  operatorRole: 'an independent developer',
  operatorRoleZh: '一名独立开发者',
  /**
   * Country of residence, which is what governs the Terms for a person
   * rather than a company. No street address is published: an individual's
   * home address does not belong on a public page, and neither the Chrome
   * Web Store nor Stripe requires it to be published -- they collect it
   * privately during verification.
   */
  jurisdiction: "the People's Republic of China",
  jurisdictionZh: '中华人民共和国',

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
 * Each row carries both languages. Keeping them in one object is what makes
 * a half-done translation visible in review: adding a provider without its
 * `*Zh` fields is a type error, not a Chinese page that quietly falls back
 * to English.
 *
 * GDPR calls these sub-processors and requires them listed; Chrome Web Store
 * asks the same question in different words. Keeping the list in code means
 * adding an integration puts this file in the diff.
 */
export const SUBPROCESSORS = [
  {
    name: 'Clerk',
    purpose: 'Sign-in and account management',
    purposeZh: '登录与账号管理',
    data: 'Email address, authentication events',
    dataZh: '邮箱地址、登录事件',
    location: 'United States',
    locationZh: '美国',
    url: 'https://clerk.com/legal/privacy',
  },
  {
    name: 'Stripe',
    purpose: 'Payments and subscriptions',
    purposeZh: '支付与订阅',
    data: 'Email address, payment details, billing history',
    dataZh: '邮箱地址、支付信息、账单记录',
    location: 'United States',
    locationZh: '美国',
    url: 'https://stripe.com/privacy',
  },
  {
    name: `${AI_PROVIDER.name} (${AI_PROVIDER.model})`,
    purpose: 'Sentence and in-context translation',
    purposeZh: '整句与语境内翻译',
    data: 'The sentence or phrase you select, and the word you clicked',
    dataZh: '你划选的句子或短语，以及你点击的那个词',
    location: LEGAL.hostingRegion,
    locationZh: LEGAL.hostingRegion,
    url: AI_PROVIDER.privacyUrl,
  },
  {
    name: 'Sentry',
    purpose: 'Crash reporting and performance monitoring',
    // Deliberately mentions the API request URLs: performance traces record
    // calls like /api/word/<word>, so a looked-up word reaches Sentry. That
    // is the same vocabulary the policy already says we store, but it is a
    // second copy in a second country, which is exactly the kind of thing a
    // sub-processor list exists to surface.
    purposeZh: '崩溃报告与性能监控',
    data: 'Error messages, stack traces, browser and version information, and the URLs of requests made to our own API (which can include a word you looked up)',
    dataZh: '错误信息、调用栈、浏览器与版本信息，以及对我们自己 API 的请求地址（其中可能包含你查过的某个词）',
    location: 'United States',
    locationZh: '美国',
    url: 'https://sentry.io/privacy/',
  },
  {
    name: 'Amazon Web Services',
    purpose: 'Hosting',
    purposeZh: '服务器托管',
    data: 'All data described in this policy',
    dataZh: '本政策中描述的全部数据',
    location: LEGAL.hostingRegion,
    locationZh: LEGAL.hostingRegion,
    url: 'https://aws.amazon.com/privacy/',
  },
] as const
