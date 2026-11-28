// The messages the extension's parts send each other, one entry per message:
// what goes on the wire and what comes back (#1268).
//
// The wire format is fixed. A content script outlives an extension update
// (lib/extensionContext.ts), so a page may still send or expect the old shape:
// never rename a message or change the key it is sent under. Some messages
// are keyed on `type` and some on `action`; the background reads either
// (`request.type || request.action`), the content script reads `action` only.
//
// Types only: this module imports no chrome.* and has no code besides the two
// name lists, which exist so a test can compare them with the listeners.

import type { ApiRequestResult } from '@/background/background'
import type { AnonymousLookup } from '@/lib/anonymousLookup'
import type { ArticleChoiceReport } from '@/lib/articleChoiceShare'
import type { PageActionResponse } from '@/lib/enableLearningMode'
import type { FeedbackSubmission, PageFeedbackContext } from '@/lib/feedback'
import type { LearningAccess } from '@/lib/learningAccess'
import type { LearningModeStatus } from '@/lib/learningModeStatus'
import type { PageReportPayload } from '@/lib/pageReport'
import type {
  AccountInvalidatedMessage,
  PanelAccountFreshness,
} from '@/lib/panelAccountFence'
import type { PopupSummary } from '@/lib/popupSummary'
import type { ReadingAnchor } from '@/lib/readingPositions'
import type { OpenResult, WriteResult } from '@/lib/readingPositionWriter'
import type { PreferenceChanges } from '@/lib/serverPreferences'
import type { SessionLossCause } from '@/lib/signedOut'
import type { BackgroundResponse, ReadingStatsDelta, WordData } from '@/types'

type NoPayload = Record<never, never>

// A message keyed on `type`, and one keyed on `action`.
type ByType<Name extends string, Payload = NoPayload> = { type: Name } & Payload
type ByAction<Name extends string, Payload = NoPayload> = {
  action: Name
} & Payload

interface Exchange<Request, Response> {
  request: Request
  response: Response
}

type Acknowledged = { success: boolean }

// --- To the background worker (chrome.runtime.sendMessage) -----------------
//
// One entry per `case` of the onMessage switch in background.ts. Where the
// handler builds its answer from an API result the response is the shared
// `BackgroundResponse` bag, as the callers read it today.

export interface BackgroundExchanges {
  getOneWord: Exchange<
    ByType<'getOneWord', { word: string; refresh?: boolean }>,
    BackgroundResponse
  >
  learningAccess: Exchange<ByType<'learningAccess'>, { access: LearningAccess }>
  getAnonymousEntry: Exchange<
    ByType<'getAnonymousEntry', { word: string }>,
    AnonymousLookup
  >
  prefetchDefinitions: Exchange<
    ByType<'prefetchDefinitions', { words: string[] }>,
    BackgroundResponse
  >
  panelAccountFreshness: Exchange<
    ByType<'panelAccountFreshness'>,
    PanelAccountFreshness
  >
  openOptionsPage: Exchange<ByType<'openOptionsPage'>, BackgroundResponse>
  accountSignedOut: Exchange<ByType<'accountSignedOut'>, BackgroundResponse>
  getReviewWords: Exchange<ByType<'getReviewWords'>, BackgroundResponse>
  GET_POPUP_SUMMARY: Exchange<ByType<'GET_POPUP_SUMMARY'>, PopupSummary>
  markKnown: Exchange<
    ByType<'markKnown', { word: string; userId?: number }>,
    BackgroundResponse
  >
  recordWordLookup: Exchange<
    ByType<'recordWordLookup', { wordId: string }>,
    BackgroundResponse
  >
  openSentencePanel: Exchange<
    ByType<
      'openSentencePanel',
      {
        word: string
        sentence: string
        phrase?: string
        wordStates?: Record<string, WordData>
      }
    >,
    BackgroundResponse
  >
  recordPageWordLookup: Exchange<
    ByType<
      'recordPageWordLookup',
      { word: string; ecp?: WordData; reread?: boolean }
    >,
    BackgroundResponse
  >
  getExplanationLanguage: Exchange<
    ByType<'getExplanationLanguage'>,
    BackgroundResponse
  >
  recordReadingPosition: Exchange<
    ByType<'recordReadingPosition', { bookKey: string; anchor: ReadingAnchor }>,
    WriteResult
  >
  openReadingPosition: Exchange<
    ByType<'openReadingPosition', { bookKey: string }>,
    OpenResult
  >
  flushReadingPositions: Exchange<ByType<'flushReadingPositions'>, WriteResult>
  reportReadingProgress: Exchange<
    ByType<'reportReadingProgress', { delta: ReadingStatsDelta }>,
    BackgroundResponse
  >
  submitPageReport: Exchange<
    ByType<'submitPageReport', { pageReport: PageReportPayload }>,
    BackgroundResponse
  >
  submitFeedback: Exchange<
    ByType<'submitFeedback', { feedback: FeedbackSubmission }>,
    BackgroundResponse
  >
  submitArticleChoice: Exchange<
    ByType<'submitArticleChoice', { articleChoice: ArticleChoiceReport }>,
    BackgroundResponse
  >
  savePage: Exchange<
    ByType<'savePage', { savedPage: { url: string; title: string } }>,
    ApiRequestResult
  >
  removeSavedPage: Exchange<
    ByType<'removeSavedPage', { savedPageId: string }>,
    ApiRequestResult
  >
  translateSentence: Exchange<
    ByType<'translateSentence', { sentence: string }>,
    BackgroundResponse
  >
  translateWordInContext: Exchange<
    ByType<
      'translateWordInContext',
      { sentence: string; word: string; dictionaryChinese: string }
    >,
    BackgroundResponse
  >
  translateSentenceWithWords: Exchange<
    ByType<
      'translateSentenceWithWords',
      {
        sentence: string
        sentenceWords: { word: string; dictionaryChinese: string }[]
      }
    >,
    BackgroundResponse
  >
  defineWordWithAI: Exchange<
    ByType<'defineWordWithAI', { word: string }>,
    BackgroundResponse
  >
  getPreferences: Exchange<ByType<'getPreferences'>, BackgroundResponse>
  updatePreferences: Exchange<
    ByType<'updatePreferences', { changes: PreferenceChanges }>,
    BackgroundResponse
  >
  openWebSignIn: Exchange<ByAction<'openWebSignIn'>, Acknowledged>
  shouldAutoEnable: Exchange<ByType<'shouldAutoEnable'>, BackgroundResponse>
  learningModeStatus: Exchange<
    ByType<'learningModeStatus', { status: LearningModeStatus }>,
    BackgroundResponse
  >
  pinHintDismissed: Exchange<ByType<'pinHintDismissed'>, BackgroundResponse>

  // No sender in src/: typed by hand in DevTools when debugging.
  validateSession: Exchange<ByType<'validateSession'>, ApiRequestResult>
  debugStorage: Exchange<
    ByType<'debugStorage'>,
    { success: boolean; storage: Record<string, unknown>; signedIn: boolean }
  >
  getSwLog: Exchange<ByType<'getSwLog'>, { success: boolean; log: unknown }>
  hello: Exchange<ByType<'hello'>, { success: boolean; message: string }>
}

export type BackgroundMessageName = keyof BackgroundExchanges
export type BackgroundRequest =
  BackgroundExchanges[BackgroundMessageName]['request']

// --- To a tab's content script (chrome.tabs.sendMessage) -------------------
//
// One entry per `case` of the onMessage switch in content.tsx. The response
// is what a current content script answers. A script left over from an older
// version may not know the action, and a frame may not answer at all, so
// callers keep their own guards.

export interface ContentExchanges {
  panelWordLookup: Exchange<
    ByAction<'panelWordLookup', { word: string; ecp: WordData }>,
    Acknowledged
  >
  enxRun: Exchange<ByAction<'enxRun'>, PageActionResponse>
  enxStop: Exchange<ByAction<'enxStop'>, Acknowledged>
  autoEnableOnSignInReturn: Exchange<
    ByAction<'autoEnableOnSignInReturn'>,
    Acknowledged
  >
  getLearningModeStatus: Exchange<
    ByAction<'getLearningModeStatus'>,
    { status: LearningModeStatus }
  >
  chooseArticle: Exchange<ByAction<'chooseArticle'>, PageActionResponse>
  useAutomaticArticle: Exchange<
    ByAction<'useAutomaticArticle'>,
    PageActionResponse
  >
  getArticleChoice: Exchange<ByAction<'getArticleChoice'>, PageActionResponse>
  getFeedbackContext: Exchange<
    ByAction<'getFeedbackContext'>,
    PageFeedbackContext
  >
  getPageInfo: Exchange<
    ByAction<'getPageInfo'>,
    { title: string; url: string; isEnxEnabled: boolean }
  >
  accountChanged: Exchange<ByAction<'accountChanged'>, Acknowledged>
  firstSignIn: Exchange<ByAction<'firstSignIn'>, Acknowledged>
  sessionExpired: Exchange<
    ByAction<'sessionExpired', { cause?: SessionLossCause }>,
    Acknowledged
  >
}

export type ContentMessageName = keyof ContentExchanges
export type ContentRequest = ContentExchanges[ContentMessageName]['request']

// --- What the side panel hears ----------------------------------------------
//
// The side panel's two onMessage listeners only listen and never answer: the
// background is the one replier. They hear the background's account broadcast
// (lib/panelAccountFence.ts) and overhear the page's `markKnown` request to the
// background, which reaches every extension page (ADR-053).

export type SidePanelNotice =
  AccountInvalidatedMessage | BackgroundExchanges['markKnown']['request']

// --- A request's name and its response -------------------------------------

type NameOf<Request> = Request extends { type: infer Name }
  ? Name
  : Request extends { action: infer Name }
    ? Name
    : never

export type BackgroundResponseOf<Request extends BackgroundRequest> =
  BackgroundExchanges[NameOf<Request> & BackgroundMessageName]['response']

export type ContentResponseOf<Request extends ContentRequest> =
  ContentExchanges[NameOf<Request> & ContentMessageName]['response']

// --- The names, as values ---------------------------------------------------
//
// `satisfies` rejects a name that is not in the contract, and the `Missing`
// checks reject a contract entry that is not in the list.

export const BACKGROUND_MESSAGE_NAMES = [
  'getOneWord',
  'learningAccess',
  'getAnonymousEntry',
  'prefetchDefinitions',
  'panelAccountFreshness',
  'openOptionsPage',
  'accountSignedOut',
  'getReviewWords',
  'GET_POPUP_SUMMARY',
  'markKnown',
  'recordWordLookup',
  'openSentencePanel',
  'getExplanationLanguage',
  'recordPageWordLookup',
  'recordReadingPosition',
  'openReadingPosition',
  'flushReadingPositions',
  'reportReadingProgress',
  'submitPageReport',
  'submitFeedback',
  'submitArticleChoice',
  'savePage',
  'removeSavedPage',
  'translateSentence',
  'translateWordInContext',
  'translateSentenceWithWords',
  'validateSession',
  'defineWordWithAI',
  'getPreferences',
  'updatePreferences',
  'openWebSignIn',
  'debugStorage',
  'getSwLog',
  'shouldAutoEnable',
  'learningModeStatus',
  'pinHintDismissed',
  'hello',
] as const satisfies readonly BackgroundMessageName[]

export const CONTENT_MESSAGE_NAMES = [
  'panelWordLookup',
  'enxRun',
  'enxStop',
  'autoEnableOnSignInReturn',
  'getLearningModeStatus',
  'chooseArticle',
  'useAutomaticArticle',
  'getArticleChoice',
  'getFeedbackContext',
  'getPageInfo',
  'accountChanged',
  'firstSignIn',
  'sessionExpired',
] as const satisfies readonly ContentMessageName[]

type Missing<All, Listed> = Exclude<All, Listed>
type NoneMissing<T extends never> = T
export type BackgroundNamesAreComplete = NoneMissing<
  Missing<BackgroundMessageName, (typeof BACKGROUND_MESSAGE_NAMES)[number]>
>
export type ContentNamesAreComplete = NoneMissing<
  Missing<ContentMessageName, (typeof CONTENT_MESSAGE_NAMES)[number]>
>
