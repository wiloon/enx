// ENX Background Script - Handles API communication and message routing
// Note: Sentry initialization is skipped in service worker context to avoid import issues

import {
  createDictionaryCache,
  openDictionaryCache,
} from '@/lib/dictionaryCache'
import {
  definitionFromEntries,
  requestDictionaryEntries,
} from '@/lib/dictionaryEntries'
import { wordKey } from '@/lib/wordHighlight'
import { createAccountSession, type Invalidation } from '@/lib/accountSession'
import { createCoalescedSync } from '@/lib/coalescedSync'
import { createSessionCookies } from '@/lib/sessionCookies'
import type { FeedbackSubmission } from '@/lib/feedback'
import type { ArticleChoiceReport } from '@/lib/articleChoiceShare'
import {
  ACCOUNT_CHANGED_MESSAGE,
  type AccountInvalidatedMessage,
  type PanelAccountFreshness,
} from '@/lib/panelAccountFence'
import {
  classifySessionSync,
  outcomeWithoutToken,
  SIGN_IN_SERVICE_UNREACHABLE_MESSAGE,
  type SessionSync,
} from '@/lib/sessionSync'
import { SESSION_UNVERIFIED_MESSAGE } from '@/lib/signedOut'
import { classifyLoadedClerk } from './clerkSessionSync'
import { createClerkClient } from '@clerk/chrome-extension/client'
import { config } from '@/config/env'
import { LatestPageWordLookup, PendingSentenceContext, WordData } from '@/types'
import {
  heartbeat,
  readSwLog,
  recordWorkerBoot,
  swlog,
  WORKER_BOOTED_AT,
} from './swlog'
import {
  enqueueReport,
  flushQueue,
  utcOffsetMinutes,
  type StatsDelta,
} from './statsReporter'
import {
  enableOnNewlyGrantedSite,
  enableOnSignInReturn,
  reconcileAutoEnableScripts,
  shouldAutoEnable,
} from './autoEnable'
import {
  autoEnableOnSignInReturnOnTab,
  disableLearningModeOnTab,
  enableLearningModeOnTab,
  getLearningModeStatusOnTab,
} from '@/lib/enableLearningMode'
import { runLearningModeCommand } from '@/lib/learningModeCommand'
import { applyStatus, dismissPinHint, maybeAskToPin, resetTab } from './badge'
import type { LearningModeStatus } from '@/lib/learningModeStatus'
import {
  latestPageWordKey,
  openTabSidePanel,
  isTabSidePanelOpen,
  pendingSentenceKey,
} from '@/lib/sidePanel'
import { welcomeTabAction, welcomeUrlPattern } from '@/lib/welcomeTab'

console.log('ENX Background script loaded')
console.log('🌐 Config environment:', config.environment)

// Records this worker instance's boot and how long the previous instance had
// been gone -- the only reliable way to observe MV3 service-worker eviction
// (see swlog.ts). Fire-and-forget; nothing downstream depends on it.
void recordWorkerBoot()

const sleep = (ms: number): Promise<void> =>
  ms <= 0 ? Promise.resolve() : new Promise(resolve => setTimeout(resolve, ms))

// ADR-015: Clerk owns the session. The service worker holds a single Clerk
// client (synced from the website via `syncHost`) and mints a fresh, short-
// lived session JWT for every API call via `session.getToken()`.
type ClerkClient = Awaited<ReturnType<typeof createClerkClient>>
let clerkGeneration = 0
let clerkClientPromise: Promise<ClerkClient> | null = null

const getClerk = (): Promise<ClerkClient> => {
  if (!clerkClientPromise) {
    clerkClientPromise = createClerkClient({
      publishableKey: config.clerkPublishableKey,
      syncHost: config.clerkSyncHost,
      background: true,
    })
  }
  return clerkClientPromise
}

// Test-only: the cached Clerk client is module state that survives
// jest.resetAllMocks(), so a suite that needs a clean signed-in / signed-out
// starting point must flush it explicitly.
export const __resetClerkClientCacheForTests = (): void => {
  resetClerkSession()
  sessionRecheckInFlight = null
  clerkCookieSync = makeClerkCookieSync()
  sessionCookies = createSessionCookies()
  accountSession = makeAccountSession()
}

// Mitigation for a false "session expired": homelab still runs Clerk's
// *development* instance (see TASK-SPEC-enx-clerk-production-cutover.md).
// On a dev instance @clerk/chrome-extension syncs the session by reading the
// website's `__clerk_db_jwt` dev-browser cookie and replaying it to Clerk's
// Frontend API; production instead shares a first-party cookie the worker can
// read synchronously. MV3 evicts an idle service worker, wiping
// `clerkClientPromise`; when a new event wakes it, `createClerkClient()` runs
// `clerk.load()`, and if that Frontend API round-trip (authed with the synced
// dev-browser JWT) is slow, transiently fails, or the cookie hasn't propagated
// yet, the client resolves with *no session* and throws no error -- even though
// the user is still signed in on the website.
//
// So: when the first client has no session, rebuild it from scratch a few
// times with backoff (each rebuild re-runs clerk.load() -> re-reads the
// website cookie) before concluding the session is genuinely gone. Only a
// still-empty session after every retry is treated as a real logout. The real
// fix is the production Clerk cutover; this just stops a stale/slow dev-browser
// sync from surfacing as "Session Expired" mid-reading.
export const SESSION_SYNC_RETRY_DELAYS_MS =
  config.environment === 'test' ? [0, 0, 0] : [200, 500, 1000]

// Single-flight (#15): a page load fires many lookups at once into a
// just-woken worker. Without this, each caller runs its own retry loop and
// they interleave at the `await`, every one nulling and rebuilding
// `clerkClientPromise` -- N overlapping clerk.load() round-trips per retry
// round, enough to trip dev-instance rate limiting. Concurrent callers now
// share one sync; it is cleared once settled, so a later call (e.g. after the
// user signs in) gets a fresh attempt instead of a pinned "signed out".
let syncedClerkInFlight: Promise<ClerkClient> | null = null

// Supersedes the syncs in flight; their callers join the next one.
const supersedeClerkSync = () => {
  clerkGeneration++
  syncedClerkInFlight = null
}

const resetClerkSession = () => {
  supersedeClerkSync()
  clerkClientPromise = null
  cookiesSynced = undefined
}

// Thrown when a sync came back without a session Clerk confirmed is gone
// (#688). The owner is left alone: only a confirmed sync is observed.
class SessionSyncUnconfirmed extends Error {
  constructor() {
    super('Clerk session sync unconfirmed')
  }
}

// Thrown when a newer Clerk check or an account change superseded the one in
// progress; callers join the latest check or fence the request.
class SessionChanged extends Error {
  constructor() {
    super('Session changed')
  }
}

const syncAndObserveClerk = async (): Promise<ClerkClient> => {
  const requested = clerkGeneration
  const clerk = await syncClerk()
  if (requested !== clerkGeneration) throw new SessionChanged()
  const sync = await classifyLoadedClerk(clerk)
  if (requested !== clerkGeneration) throw new SessionChanged()
  if (sync === 'unconfirmed') throw new SessionSyncUnconfirmed()
  await accountSession.observe(clerk.user?.id ?? null)
  if (requested !== clerkGeneration) throw new SessionChanged()
  return clerk
}

// Cookie refreshes can supersede a check without changing accounts. Join the
// latest check; the request's account scope decides whether its eventual
// identity is still safe for the original caller.
const joinLatestCheck = (error: unknown): Promise<ClerkClient> => {
  if (error instanceof SessionChanged) return getSyncedClerk()
  throw error
}

const getSyncedClerk = (): Promise<ClerkClient> => {
  const cookieSync = clerkCookieSync.pending()
  if (cookieSync) return cookieSync.catch(joinLatestCheck)
  if (!syncedClerkInFlight) {
    const current = syncAndObserveClerk()
      .catch(joinLatestCheck)
      .finally(() => {
        if (syncedClerkInFlight === current) syncedClerkInFlight = null
      })
    syncedClerkInFlight = current
  }
  return syncedClerkInFlight
}

// A sign-in rewrites the website's Clerk cookies several times in a row
// (#743). No caller uses the cached client from the first change on, but the
// client is rebuilt once per burst, so a sign-in costs a few Clerk loads, not
// dozens; a burst that left the cookies as the last rebuild saw them keeps
// the client it has.
const COOKIE_SYNC_QUIET_MS = 1000
const COOKIE_SYNC_MAX_WAIT_MS = 2000

let sessionCookies = createSessionCookies()
// The session cookies the cached client was rebuilt for, until a reset.
let cookiesSynced: string | undefined

const makeClerkCookieSync = () =>
  createCoalescedSync({
    run: async () => {
      const cookies = sessionCookies.snapshot()
      if (cookies === cookiesSynced && clerkClientPromise)
        return clerkClientPromise
      resetClerkSession()
      const clerk = await syncAndObserveClerk()
      cookiesSynced = cookies
      return clerk
    },
    quietMs: COOKIE_SYNC_QUIET_MS,
    maxWaitMs: COOKIE_SYNC_MAX_WAIT_MS,
  })
let clerkCookieSync = makeClerkCookieSync()

const syncClerk = async (): Promise<ClerkClient> => {
  const requested = clerkGeneration
  let clerk = await getClerk()
  if (requested !== clerkGeneration) throw new SessionChanged()
  if (clerk.session) return clerk

  for (
    let attempt = 1;
    attempt <= SESSION_SYNC_RETRY_DELAYS_MS.length;
    attempt++
  ) {
    await sleep(SESSION_SYNC_RETRY_DELAYS_MS[attempt - 1])
    if (requested !== clerkGeneration) throw new SessionChanged()
    clerkClientPromise = null
    clerk = await getClerk()
    if (requested !== clerkGeneration) throw new SessionChanged()
    if (clerk.session) {
      swlog(
        `clerk session recovered on retry ${attempt} ` +
          `(+${Date.now() - WORKER_BOOTED_AT}ms since worker boot)`
      )
      return clerk
    }
  }

  swlog(
    `clerk session still empty after ${SESSION_SYNC_RETRY_DELAYS_MS.length} ` +
      `retries (+${Date.now() - WORKER_BOOTED_AT}ms since worker boot)`,
    'warn'
  )
  return clerk
}

// getToken() can also fail transiently on its own: the session exists but the
// short-lived JWT needs refreshing and that Frontend API call blips. Retry a
// couple of times before giving up and rechecking the session (#688).
const GET_TOKEN_RETRY_DELAYS_MS =
  config.environment === 'test' ? [0, 0] : [300, 700]

// What getSessionToken found: the first sync, and the recheck when every mint
// failed. Without a token, the request decides on the latest of them (#688).
type SessionToken = {
  token: string | null
  isCurrent: () => boolean
  sync: SessionSync
  failedMints: number
  lastMintError: string | null
  recheck: SessionSync | null
}

// A session whose mints all failed is rechecked once from scratch: one
// reset and sync, then one fresh mint, shared by every caller waiting on it.
let sessionRecheckInFlight: Promise<{
  sync: SessionSync
  token: string | null
}> | null = null

const recheckSession = () => {
  if (!sessionRecheckInFlight) {
    const current = (async () => {
      resetClerkSession()
      let clerk: ClerkClient
      try {
        clerk = await getSyncedClerk()
      } catch (error) {
        if (error instanceof SessionChanged) throw error
        swlog(`session recheck failed: ${String(error)}`, 'warn')
        return { sync: 'unconfirmed' as const, token: null }
      }
      if (!clerk.session) return { sync: 'absent' as const, token: null }
      try {
        const token =
          (await clerk.session.getToken({ skipCache: true })) ?? null
        return { sync: 'present' as const, token }
      } catch (error) {
        swlog(`fresh getToken() after recheck threw: ${String(error)}`, 'warn')
        return { sync: 'present' as const, token: null }
      }
    })().finally(() => {
      if (sessionRecheckInFlight === current) sessionRecheckInFlight = null
    })
    sessionRecheckInFlight = current
  }
  return sessionRecheckInFlight
}

// `forceRefresh` bypasses clerk-js's in-memory token cache (getToken({
// skipCache: true })). Needed after a 401: clerk-js refreshes the ~60s session
// JWT on a setTimeout that does NOT fire while an MV3 worker is suspended, so a
// warm-looking worker can hand out a token minted 15 min ago -- long expired --
// without re-minting. Forcing a fresh mint (or surfacing that the mint itself
// fails) is the only way to tell a stale cache from a real logout.
// `synced` is a client a cookie-change sync already settled on; its caller
// waited for it, so it is not synced again.
const getSessionToken = async (
  opts: { forceRefresh?: boolean; synced?: ClerkClient } = {}
): Promise<SessionToken> => {
  const noToken = {
    token: null,
    failedMints: 0,
    lastMintError: null,
    recheck: null,
  }
  let clerk: ClerkClient
  try {
    clerk = opts.synced ?? (await getSyncedClerk())
  } catch (error) {
    if (error instanceof SessionChanged) throw error
    swlog(`getSyncedClerk failed: ${String(error)}`, 'error')
    return {
      ...noToken,
      isCurrent: accountSession.capture(),
      sync: classifySessionSync({ loaded: false }),
    }
  }

  const isCurrent = accountSession.capture()
  if (!clerk.session) return { ...noToken, isCurrent, sync: 'absent' }

  const getTokenOpts = opts.forceRefresh ? { skipCache: true } : undefined
  let failedMints = 0
  let lastMintError: string | null = null

  for (
    let attempt = 1;
    attempt <= GET_TOKEN_RETRY_DELAYS_MS.length + 1;
    attempt++
  ) {
    try {
      const token = (await clerk.session.getToken(getTokenOpts)) ?? null
      if (token) {
        return {
          token,
          isCurrent,
          sync: 'present',
          failedMints,
          lastMintError,
          recheck: null,
        }
      }
      lastMintError = 'returned null'
      swlog(`clerk getToken() returned null (attempt ${attempt})`, 'warn')
    } catch (error) {
      lastMintError = String(error)
      swlog(
        `clerk getToken() threw (attempt ${attempt}): ${String(error)}`,
        'warn'
      )
    }
    failedMints++
    if (attempt <= GET_TOKEN_RETRY_DELAYS_MS.length) {
      await sleep(GET_TOKEN_RETRY_DELAYS_MS[attempt - 1])
    }
  }

  const recheck = await recheckSession()
  return {
    token: recheck.token,
    isCurrent,
    sync: 'present',
    failedMints,
    lastMintError,
    recheck: recheck.sync,
  }
}

const isSignedIn = async (): Promise<boolean> => {
  try {
    return Boolean((await getSyncedClerk()).session)
  } catch (error) {
    console.error('Clerk session check failed:', error)
    return false
  }
}

// What each tab hears about an invalidation (#236). A lost session keeps an
// open word popover, signed out; `cause` tells a confirmed 401 (error badge)
// from a sign-out observed elsewhere (badge off).
const invalidationMessage = (cause: Invalidation) => {
  switch (cause) {
    case 'expired':
      return { action: 'sessionExpired', cause: 'expired' }
    case 'lost':
      return { action: 'sessionExpired', cause: 'signed-out' }
    default:
      return { action: 'accountChanged' }
  }
}

// A page with learning mode off can still hold a successful review list.
// Notify all tabs and tolerate pages without an injected content script.
// Extension pages (the side panel) hear the raw cause, and none may be open.
const notifyAccountChange = async (cause: Invalidation) => {
  const pages: AccountInvalidatedMessage = {
    action: 'accountInvalidated',
    cause,
  }
  const notifyPages = Promise.resolve().then(() =>
    chrome.runtime.sendMessage(pages)
  )
  const tabs = await chrome.tabs.query({})
  const message = invalidationMessage(cause)
  await Promise.allSettled([
    notifyPages,
    ...tabs
      .filter(tab => tab.id !== undefined)
      .map(tab => chrome.tabs.sendMessage(tab.id!, message)),
  ])
}

const ACCOUNT_SESSION_OWNER_KEY = 'enx-account-session-owner'
const makeAccountSession = () =>
  createAccountSession({
    readOwner: async () => {
      const owner = (
        await chrome.storage.session.get(ACCOUNT_SESSION_OWNER_KEY)
      )?.[ACCOUNT_SESSION_OWNER_KEY]
      return typeof owner === 'string' || owner === null ? owner : undefined
    },
    writeOwner: async owner => {
      await chrome.storage.session.set({ [ACCOUNT_SESSION_OWNER_KEY]: owner })
    },
    invalidate: cause => notifyAccountChange(cause),
  })
let accountSession = makeAccountSession()

const handleSessionExpiry = async () => {
  console.log('Session expired (401 from API)')
  await accountSession.clear('expired')
}

// Register synchronously so cookie changes wake an evicted MV3 worker too.
// Rebuild the client: an already-loaded client's cached session can still be
// the old account. JWT refreshes for the same user do not invalidate pages.
// The promise settles with the sync that covers this change (#743).
chrome.cookies.onChanged.addListener(change => {
  const host = new URL(config.clerkSyncHost).hostname
  const domain = change.cookie.domain.replace(/^\./, '')
  if (host !== domain && !host.endsWith(`.${domain}`)) return
  if (!/^__(client|client_uat|clerk_db_jwt)(_|$)/.test(change.cookie.name))
    return
  if (change.removed && change.cause === 'overwrite') return
  sessionCookies.record(change)
  // A rewrite that leaves the cookies as the cached client saw them changes
  // nothing: end the open burst now so requests do not wait for its timers.
  if (
    clerkClientPromise &&
    sessionCookies.snapshot() === cookiesSynced &&
    clerkCookieSync.settleNow(clerkClientPromise)
  )
    return Promise.resolve()
  supersedeClerkSync()
  return clerkCookieSync
    .change()
    .then(() => {})
    .catch(error => {
      console.error('Could not check changed account session:', error)
    })
})

export type ApiRequestResult = {
  success: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: any
  error?: string
  sessionExpired?: boolean
  // The forced replay carried a freshly minted token and still got a 401
  // (#686): the account session is left alone.
  sessionUnverified?: boolean
  // With sessionUnverified: the account generation the request ran under,
  // so the side panel can tell at delivery whether the account has changed.
  accountGeneration?: number
  // HTTP status of a failed response (undefined for network-level failures
  // that never got a response at all). Lets callers distinguish billing
  // errors -- 402 insufficient AI credit, 429 daily dictionary quota
  // exceeded -- from a generic failure, so the UI can point the user at
  // /billing instead of just showing "translation failed" (TASK-SPEC
  // §4.1/§4.2, Phase 4).
  status?: number
  // The failed response's own `code`, when enx-api gave one. The 429s are
  // told apart by it, not by status (ADR-060 Decision 4): too_many_requests
  // (request rate limit), lookup_quota_exceeded, trial_limit_day/_minute,
  // rate_limited (AI lookups).
  code?: string
  // Retry-After, in milliseconds, when the response carried one.
  retryAfterMs?: number
  // fetch itself failed, so there was no response at all.
  networkError?: boolean
}

// Retry-After in seconds (the only form enx-api sends), as milliseconds.
const retryAfterMs = (response: Response): number | undefined => {
  const seconds = Number(response.headers?.get('Retry-After'))
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined
}

const GATEWAY_ERROR_STATUSES = new Set([502, 503, 504])
// Waits before replaying a request the gateway answered 503 on its own, e.g.
// Kong with no ready enx-api pod during a Recreate redeploy (a few seconds).
// Only 503: the request never reached enx-api, so a replay cannot charge AI
// credit or bump a Query Count twice. A gateway 502/504 can come after
// enx-api already handled the request, so those are not replayed.
export const GATEWAY_RETRY_DELAYS_MS = [500, 1500]
export const SERVICE_UNAVAILABLE_MESSAGE =
  'Service temporarily unavailable. Please retry.'
// Shown when fetch itself fails (offline, DNS, host unreachable). The target
// URL and the Options hint are for developers, so they go to swlog instead.
export const NETWORK_ERROR_MESSAGE =
  "Couldn't connect to Catglish. Check your internet connection and try again."

// Waits before replaying a call that opted in with `{ retry: true }` (#133).
// Only calls safe to repeat may opt in: they can be replayed after a network
// failure or any 5xx, even when enx-api already handled the first attempt.
// The lookup GET qualifies: it only reads the Query Count, and a replay
// costs at most one more lookup against the daily quota (ADR-059 Decision
// 3). POST /api/me/word-lookups (adds to the Query Count) and AI calls
// (spend credit) must not.
export const IDEMPOTENT_RETRY_DELAYS_MS = [500, 1500]

export interface ApiRequestPolicy {
  retry?: boolean
}

const isNetworkFailure = (error: unknown): boolean =>
  error instanceof TypeError && error.message.includes('Failed to fetch')

// API request helper
export const makeApiRequest = async (
  endpoint: string,
  options: RequestInit = {},
  { retry = false }: ApiRequestPolicy = {}
): Promise<ApiRequestResult> => {
  // An API call proves the worker is alive; refresh the heartbeat so the next
  // cold boot can report how long this instance had been gone (swlog.ts).
  void heartbeat()

  // Two kinds of replay. A 401 is almost always an expired session JWT
  // served from clerk-js's cache (see getSessionToken) -- force a fresh mint
  // and replay once. A request never goes out without a token (#688), so a
  // 401 on that replay was refused with a fresh one (#686). A gateway 503
  // (see GATEWAY_RETRY_DELAYS_MS) is replayed after a short wait.
  //
  // A request made while a cookie change is being synced waits for that
  // sync (#743): its token and account scope come from the account it
  // settled on, never from the stale client.
  const cookieSync = clerkCookieSync.pending()
  const synced = cookieSync
    ? await cookieSync.catch(() => undefined)
    : undefined
  const requestIsCurrent = accountSession.capture()
  const requestGeneration = accountSession.generation()
  // A response that lands while a cookie change is being synced is applied
  // only once that sync has said whose session it is now.
  const responseIsCurrent = async () => {
    const pending = clerkCookieSync.pending()
    if (pending) await pending.catch(() => {})
    return requestIsCurrent()
  }
  let forceRefresh = false
  let gatewayRetries = 0
  let idempotentRetries = 0
  // Waits and reports true while an opted-in call has retries left.
  const waitToRetry = async (reason: string): Promise<boolean> => {
    if (!retry || idempotentRetries >= IDEMPOTENT_RETRY_DELAYS_MS.length) {
      return false
    }
    const delay = IDEMPOTENT_RETRY_DELAYS_MS[idempotentRetries++]
    swlog(
      `${reason} from ${endpoint}, retry ${idempotentRetries} in ${delay}ms`,
      'warn'
    )
    await new Promise(resolve => setTimeout(resolve, delay))
    return true
  }

  try {
    for (let attempt = 1; ; attempt++) {
      if (!requestIsCurrent()) throw new SessionChanged()
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        // Every call carries the user's UTC offset so the server can file
        // what it counts under the user's own calendar day (ADR-029
        // Decision 7a). It is on the shared helper rather than on the
        // lookup call because "which day is it for this user" is a property
        // of the caller, not of one endpoint -- and because a lookup that
        // silently lands on yesterday is invisible until someone reads a
        // chart and finds it wrong.
        'X-Enx-Tz-Offset': String(utcOffsetMinutes()),
        ...((options.headers as Record<string, string>) || {}),
      }

      const session = await getSessionToken({
        forceRefresh,
        synced: attempt === 1 ? synced : undefined,
      })
      const token = session.token
      const outcome = token
        ? null
        : outcomeWithoutToken(session.recheck ?? session.sync)
      if (outcome) {
        swlog(
          `no session token for ${options.method ?? 'GET'} ${endpoint}: ` +
            `${session.failedMints} failed getToken() attempts` +
            (session.lastMintError
              ? ` (last error: ${session.lastMintError})`
              : '') +
            `, sync=${session.sync}, recheck=${session.recheck ?? 'none'}, ` +
            `forceRefresh=${forceRefresh} -> ${outcome}`,
          'warn'
        )
      }
      if (!requestIsCurrent() || !session.isCurrent())
        throw new SessionChanged()
      if (!token) {
        if (outcome === 'transient') {
          return { success: false, error: SIGN_IN_SERVICE_UNREACHABLE_MESSAGE }
        }
        // Observing the signed-out sync fenced a signed-in owner's request
        // as lost; with no owner to fence, the session expires here.
        await handleSessionExpiry()
        throw new Error('Session expired')
      }
      headers['Authorization'] = `Bearer ${token}`

      let response: Response
      try {
        response = await fetch(`${config.apiBaseUrl}${endpoint}`, {
          ...options,
          headers,
        })
      } catch (error) {
        if (isNetworkFailure(error) && (await waitToRetry('network failure'))) {
          continue
        }
        throw error
      }

      if (!(await responseIsCurrent())) throw new SessionChanged()

      console.log(
        `API response status: ${response.status} ${response.statusText}`
      )

      if (!response.ok) {
        if (response.status === 401) {
          // Body tells stale-token ("token expired") from a config/signature
          // problem ("invalid token"); log it plus how long the worker has
          // been up (a real logout can 401 with a token too, but not right
          // after other calls in the same worker succeeded).
          const body = await response.text().catch(() => '')
          if (!(await responseIsCurrent())) throw new SessionChanged()
          swlog(
            `401 from ${endpoint}: ` +
              `forceRefresh=${forceRefresh}, attempt=${attempt}, ` +
              `+${Date.now() - WORKER_BOOTED_AT}ms since worker boot; body=${body.slice(0, 200)}`,
            'warn'
          )

          if (!forceRefresh) {
            swlog('retrying once with a force-refreshed Clerk token', 'warn')
            forceRefresh = true
            continue
          }

          // An enx-api 401 alone never ends the session (#686, #688).
          swlog(
            `session unverified: ${endpoint} refused the freshly minted ` +
              `Clerk token …${token.slice(-8)}; keeping the account session`,
            'warn'
          )
          return {
            success: false,
            error: SESSION_UNVERIFIED_MESSAGE,
            sessionUnverified: true,
            accountGeneration: requestGeneration,
          }
        }

        if (
          response.status >= 500 &&
          (await waitToRetry(`HTTP ${response.status}`))
        ) {
          continue
        }

        // Try to get error details from response body
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`
        let fromApi = false
        let code: string | undefined
        try {
          const errorData = await response.json()
          if (errorData.error || errorData.message) {
            errorMessage = errorData.error || errorData.message
          }
          if (typeof errorData.code === 'string') code = errorData.code
          fromApi = 'success' in errorData || 'error' in errorData
        } catch {
          // Ignore JSON parsing errors, use default message
        }

        // A 502/503/504 that enx-api did not write itself came from the
        // gateway in front of it (Kong's "failure to get a peer from the
        // ring-balancer" during a homelab redeploy, a Cloudflare/nginx HTML
        // page in production). Its text means nothing to a reader.
        if (GATEWAY_ERROR_STATUSES.has(response.status) && !fromApi) {
          // An opted-in call already spent its own retries above.
          if (
            !retry &&
            response.status === 503 &&
            gatewayRetries < GATEWAY_RETRY_DELAYS_MS.length
          ) {
            const delay = GATEWAY_RETRY_DELAYS_MS[gatewayRetries++]
            swlog(
              `gateway 503 from ${endpoint}, retry ${gatewayRetries} in ${delay}ms`,
              'warn'
            )
            await new Promise(resolve => setTimeout(resolve, delay))
            continue
          }
          errorMessage = SERVICE_UNAVAILABLE_MESSAGE
        }

        // Returned directly (not thrown) so response.status survives into
        // ApiRequestResult -- the catch block below only handles genuine
        // exceptions (network failure, session expiry) that never got a
        // real HTTP status.
        const failure: ApiRequestResult = {
          success: false,
          error: errorMessage,
          status: response.status,
        }
        if (code) failure.code = code
        const wait = retryAfterMs(response)
        if (wait !== undefined) failure.retryAfterMs = wait
        return failure
      }

      if (forceRefresh) {
        swlog(`${endpoint} succeeded after force-refreshing the Clerk token`)
      }
      const data = await response.json()
      if (!(await responseIsCurrent())) throw new SessionChanged()
      console.log('API response data:', data)
      return { success: true, data }
    }
  } catch (error) {
    console.error('API request failed:', error)

    // A request the account fence stopped (#236): its session was lost
    // unless the latest invalidation switched to another signed-in account,
    // which is an ordinary failure for whoever asked.
    if (
      error instanceof SessionChanged ||
      (error instanceof Error && error.message === 'Session expired')
    ) {
      return accountSession.sessionLost()
        ? {
            success: false,
            error: 'Your session has expired. Please login again.',
            sessionExpired: true,
          }
        : { success: false, error: ACCOUNT_CHANGED_MESSAGE }
    }

    // Network errors
    if (isNetworkFailure(error)) {
      // In development the cause is usually the build's API host being down;
      // keep that detail in the log.
      swlog(
        `network failure reaching ${config.apiBaseUrl}${endpoint} -- is the API server up?`,
        'warn'
      )
      return {
        success: false,
        error: NETWORK_ERROR_MESSAGE,
        networkError: true,
      }
    }

    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : 'Translation service temporarily unavailable',
    }
  }
}

// ADR-047 Decision 1: a fresh install lands on enx-ui's /welcome. A user who
// came from /welcome to the store still has it open, so switch back to it.
const openWelcomePage = async (
  reason: chrome.runtime.InstalledDetails['reason']
): Promise<void> => {
  const base = config.frontendBaseUrl
  const tabs =
    reason === 'install'
      ? await chrome.tabs.query({ url: welcomeUrlPattern(base) })
      : []
  const action = welcomeTabAction(reason, base, tabs)
  if (action.kind === 'open') {
    await chrome.tabs.create({ url: action.url })
  } else if (action.kind === 'focus') {
    await chrome.tabs.update(action.tabId, { active: true })
    await chrome.windows.update(action.windowId, { focused: true })
  }
}

// Handle extension installation
chrome.runtime.onInstalled.addListener(async details => {
  console.log('ENX Extension installed:', details.reason)

  if (details.reason === 'install') {
    console.log('ENX Extension installed for the first time')
    // Initialize storage
    await chrome.storage.local.set({
      enxEnabled: false,
      wordCache: {},
    })
  } else if (details.reason === 'update') {
    console.log('ENX Extension updated')
  }

  await openWelcomePage(details.reason).catch(error =>
    console.error('Failed to open /welcome:', error)
  )

  // Warm the Clerk client (syncs the session from the website via syncHost).
  void getClerk()

  // Trigger path② (spec §3.2): a right-click menu item is a Chrome-approved
  // user gesture source, same as an actual click, so sidePanel.open() called
  // from its onClicked handler is reliable -- unlike forwarding a content
  // script's click through runtime.sendMessage (trigger path③).
  chrome.contextMenus.create(
    {
      id: 'enx-open-sentence-panel',
      title: 'Open sentence translation panel',
      contexts: ['action'],
    },
    () => {
      // Re-registering an existing id throws via chrome.runtime.lastError
      // (not a JS exception) on repeated onInstalled "update" events; that's
      // expected, not an error worth surfacing.
      if (chrome.runtime.lastError) {
        console.debug('contextMenus.create:', chrome.runtime.lastError.message)
      }
    }
  )
})

// adr-039: keep the per-site auto-enable scripts in line with the optional
// host permissions the user granted. Registration happens here rather than in
// the popup, which Chrome may close while its permission dialog is up.
const reconcileAutoEnable = () =>
  reconcileAutoEnableScripts().catch(error =>
    console.error('Failed to reconcile auto-enable scripts:', error)
  )
chrome.permissions.onAdded.addListener(async added => {
  await reconcileAutoEnable()
  await enableOnNewlyGrantedSite(added ?? {}, {
    isSignedIn,
    getStatus: getLearningModeStatusOnTab,
    enable: enableLearningModeOnTab,
  }).catch(error =>
    console.error('Failed to turn on a newly granted site:', error)
  )
})
chrome.permissions.onRemoved.addListener(reconcileAutoEnable)
chrome.runtime.onStartup.addListener(reconcileAutoEnable)
// Covers updates too: the hashed content-script bundle is renamed.
chrome.runtime.onInstalled.addListener(reconcileAutoEnable)

// The page's origin comes from Chrome's sender info, never from the message.
// Signed out, auto-enabling would only put a session notice on every page, so
// it answers false -- but the badge says why (adr-046 Decision 7).
const handleShouldAutoEnable = async (
  sender: chrome.runtime.MessageSender
): Promise<boolean> => {
  const origin = sender.origin ?? sender.tab?.url
  if (!(await shouldAutoEnable(origin))) return false
  if (await isSignedIn()) return true
  const tabId = topFrameTabId(sender)
  if (tabId !== undefined) {
    await applyStatus(tabId, { status: 'error', reason: 'signed-out' })
  }
  return false
}

// adr-046: the badge belongs to the tab, so only its top frame may set it,
// and the tab comes from Chrome's sender info, never from the message.
const topFrameTabId = (
  sender: chrome.runtime.MessageSender
): number | undefined => (sender.frameId === 0 ? sender.tab?.id : undefined)

const LEARNING_MODE_STATUSES = new Set(['off', 'processing', 'ready', 'error'])

const handleLearningModeStatus = async (
  status: LearningModeStatus | undefined,
  sender: chrome.runtime.MessageSender
): Promise<{ success: boolean; showPinHint?: boolean; error?: string }> => {
  const tabId = topFrameTabId(sender)
  if (tabId === undefined) {
    return { success: false, error: 'Not a top-level tab frame' }
  }
  if (!status || !LEARNING_MODE_STATUSES.has(status.status)) {
    return { success: false, error: 'Unknown learning mode status' }
  }
  await applyStatus(tabId, status)
  // Decision 6: an unpinned icon hides the badge; ask once it has news.
  const showPinHint = status.status === 'ready' && (await maybeAskToPin())
  return { success: true, showPinHint }
}

// Decision 4: Chrome keeps a per-tab badge across navigations, so drop it
// when the tab starts loading; the new page's content script reports afresh.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== 'loading') return
  resetTab(tabId).catch(error =>
    console.debug('badge: reset failed (tab gone?)', error)
  )
})

// Trigger path② (spec §3.2): right-click the toolbar icon -> menu item ->
// open the current tab's own Side Panel (ADR-050). Independent of the
// left-click default_popup behavior (trigger path①), so it can't interfere
// with login/logout. Not async: open() has to run inside the menu click's
// user gesture, before any await.
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'enx-open-sentence-panel') return
  if (tab?.id === undefined) return

  openTabSidePanel(tab.id).catch(error =>
    console.error('Failed to open side panel from context menu:', error)
  )
})

// ADR-050: no window-wide Side Panel. The manifest declares no default_path;
// this also switches off any global panel an older version left registered,
// so Chrome's side panel menu can't open an ENX panel that belongs to no tab.
// Every panel is a tab-specific one, registered by openTabSidePanel().
chrome.sidePanel
  .setOptions({ enabled: false })
  .catch(error =>
    console.warn('Failed to disable the window-wide side panel:', error)
  )

// A tab's panel goes away with the tab; drop what it was showing too, so
// storage.session doesn't accumulate one entry per tab ever read in.
chrome.tabs.onRemoved.addListener(tabId => {
  chrome.storage.session
    .remove([pendingSentenceKey(tabId), latestPageWordKey(tabId)])
    .catch(error =>
      console.warn('Failed to clear side panel state for closed tab:', error)
    )
})

// #230: Alt+C (or whatever the user bound) turns learning mode on or off on
// the current tab. The command grants activeTab, as opening the popup does.
// Returns the run so tests can await it; Chrome ignores the value.
chrome.commands.onCommand.addListener((command, tab) =>
  runLearningModeCommand(command, tab?.id, {
    getStatus: getLearningModeStatusOnTab,
    isSignedIn,
    enable: enableLearningModeOnTab,
    disable: disableLearningModeOnTab,
    showOnBadge: applyStatus,
  })
    .then(() => undefined)
    .catch(error =>
      console.error('Failed to toggle learning mode from the shortcut:', error)
    )
)

// Handle extension icon clicks
chrome.action.onClicked.addListener(async tab => {
  console.log('ENX Extension icon clicked', tab)

  // Check if user is logged in (Clerk session synced from the website)
  if (!(await isSignedIn())) {
    console.log('User not logged in, popup will handle this')
    return
  }

  // Toggle ENX functionality on current tab
  if (tab.id) {
    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'enxRun' })
    } catch (error) {
      console.error('Error sending message to tab:', error)
    }
  }
})

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Background received message:', request)

  // Trigger path③ (spec §3.2): chrome.sidePanel.open() only works inside the
  // user gesture that Chrome forwards with a content-script runtime.sendMessage,
  // and that gesture is spent by the first `await`. So fire open() here --
  // synchronously, before handleAsync()'s storage writes -- rather than inside
  // handleOpenSentencePanel. Its outcome is awaited later via this promise.
  const sentencePanelOpening =
    (request.type || request.action) === 'openSentencePanel'
      ? openSentencePanelForGesture(sender.tab?.id)
      : undefined

  // Handle async responses
  const handleAsync = async () => {
    try {
      switch (request.type || request.action) {
        case 'getOneWord':
          return await handleGetOneWord(request.word, request.refresh === true)

        case 'panelAccountFreshness':
          return {
            sessionLost: accountSession.sessionLost(),
            accountGeneration: accountSession.generation(),
          } satisfies PanelAccountFreshness

        case 'accountSignedOut':
          resetClerkSession()
          await accountSession.clear('signed-out')
          dictionaryCacheGeneration++
          try {
            await workerDictionaryCache().clear()
          } catch {
            /* Best effort; no user data. */
          }
          return { success: true }

        case 'getReviewWords':
          return await handleGetReviewWords()

        case 'markKnown':
          return await handleMarkKnown(request.word, request.userId)

        case 'recordWordLookup':
          return await handleRecordWordLookup(request.wordId || '')

        case 'openSentencePanel':
          return await handleOpenSentencePanel(
            sender.tab?.id,
            request.word || '',
            request.sentence || request.word || '',
            request.phrase || undefined,
            sentencePanelOpening,
            request.wordStates
          )

        case 'recordPageWordLookup':
          return await handleRecordPageWordLookup(
            sender.tab?.id,
            request.word || '',
            request.ecp
          )

        case 'reportReadingProgress':
          return await handleReportReadingProgress(request.delta)

        case 'submitPageReport':
          return await handleSubmitPageReport(request.pageReport)

        case 'submitFeedback':
          return await handleSubmitFeedback(request.feedback)

        case 'submitArticleChoice':
          return await handleSubmitArticleChoice(request.articleChoice)

        case 'savePage':
          return await handleSavePage(request.savedPage)

        case 'removeSavedPage':
          return await handleRemoveSavedPage(request.savedPageId)

        case 'translateSentence':
          return await handleTranslateSentence(request.sentence || '')

        case 'translateWordInContext':
          return await handleTranslateWordInContext(
            request.sentence || '',
            request.word || '',
            request.dictionaryChinese || ''
          )

        case 'translateSentenceWithWord':
          return await handleTranslateSentenceWithWord(
            request.sentence || '',
            request.word || ''
          )

        case 'validateSession':
          return await makeApiRequest('/api/me')

        // Server-side user preferences (ADR-044). The options page and, later,
        // the lookup overlay reach them through here because the session token
        // lives in this worker.
        // The AI word fallback's second request (ADR-045): define a word the
        // dictionaries lack. Sent only after a lookup missed.
        case 'defineWordWithAI':
          return await handleDefineWordWithAI(request.word)

        case 'getPreferences':
          return await makeApiRequest('/api/me/preferences')

        case 'updatePreferences':
          return await handleUpdatePreferences(request.changes)

        case 'openWebSignIn':
          return await handleOpenWebSignIn()

        case 'debugStorage': {
          // Debug command to check storage
          const storageData = await chrome.storage.local.get(null)
          console.log('All Chrome storage data:', storageData)
          return {
            success: true,
            storage: storageData,
            signedIn: await isSignedIn(),
          }
        }

        case 'getSwLog':
          // Post-mortem view of service-worker boots + auth failures
          // (swlog.ts ring buffer). Survives worker eviction.
          return { success: true, log: await readSwLog() }

        case 'shouldAutoEnable':
          return {
            success: true,
            autoEnable: await handleShouldAutoEnable(sender),
          }

        case 'learningModeStatus':
          return await handleLearningModeStatus(request.status, sender)

        case 'pinHintDismissed':
          await dismissPinHint()
          return { success: true }

        case 'hello':
          return { success: true, message: 'Hello from ENX background!' }

        default:
          return {
            success: false,
            error: 'Unknown action: ' + (request.type || request.action),
          }
      }
    } catch (error) {
      console.error('Error handling message:', error)
      return { success: false, error: 'Internal error' }
    }
  }

  // Execute async handler and send response
  handleAsync().then(sendResponse)

  return true // Keep the message channel open for async response
})

// ADR-020: the popup opens the web sign-in tab through the service worker,
// not itself -- chrome.tabs.create steals focus and Chrome destroys the popup
// before it could record where to send the user back. The worker opens the
// tab, remembers the tab the user came from, and does the cleanup when the
// /extension/connected page reports the sign-in via `enx:signed-in`.
const SIGNIN_RETURN_STORAGE_KEY = 'enx-signin-return'
const SIGNIN_RETURN_TTL_MS = 10 * 60 * 1000

// Hold on /extension/connected for a beat before closing the sign-in tab and
// switching back, so the user actually reads "You're signed in" instead of it
// flashing past. Kept in sync with the countdown shown on that page
// (enx-ui /extension/connected). Zero under test so the suite doesn't wait.
const SIGNIN_RETURN_HOLD_MS = config.environment === 'test' ? 0 : 3000

interface SignInReturn {
  originTabId: number
  originWindowId: number
  loginTabId: number
  createdAt: number
}

const handleOpenWebSignIn = async (): Promise<{ success: boolean }> => {
  const [origin] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  })

  const signInUrl =
    `${config.frontendBaseUrl}/sign-in?src=extension&redirect_url=` +
    encodeURIComponent('/extension/connected')
  const loginTab = await chrome.tabs.create({ url: signInUrl })

  if (
    origin?.id !== undefined &&
    origin.windowId !== undefined &&
    loginTab.id !== undefined
  ) {
    const record: SignInReturn = {
      originTabId: origin.id,
      originWindowId: origin.windowId,
      loginTabId: loginTab.id,
      createdAt: Date.now(),
    }
    await chrome.storage.session.set({ [SIGNIN_RETURN_STORAGE_KEY]: record })
  }

  return { success: true }
}

// ADR-020: /extension/connected reports a completed web sign-in. Close the
// sign-in tab we opened, switch focus back to the tab the user came from, and
// notify. Guarded three ways so a misfire can't close a tab the user is using:
//   1. the Clerk session must actually be live now;
//   2. close only the exact loginTabId we recorded (never sender.tab.id);
//   3. and only while that tab is still parked on /extension/connected.
const handleSignedInReturn = async (): Promise<{
  ok: boolean
  reason?: string
  returned?: boolean
}> => {
  if (!(await isSignedIn())) {
    return { ok: false, reason: 'signed-out' }
  }

  const stored = (await chrome.storage.session.get(SIGNIN_RETURN_STORAGE_KEY))[
    SIGNIN_RETURN_STORAGE_KEY
  ] as SignInReturn | undefined

  if (!stored || Date.now() - stored.createdAt > SIGNIN_RETURN_TTL_MS) {
    await chrome.storage.session.remove(SIGNIN_RETURN_STORAGE_KEY)
    return { ok: true, returned: false }
  }

  // Let the "You're signed in" page linger a moment before we yank the user
  // back -- otherwise the return trip is instant and they never see it.
  await sleep(SIGNIN_RETURN_HOLD_MS)

  try {
    const loginTab = await chrome.tabs.get(stored.loginTabId)
    const stillOnReturnPage = Boolean(
      loginTab.url?.startsWith(`${config.frontendBaseUrl}/extension/connected`)
    )
    if (stillOnReturnPage) {
      await chrome.tabs.remove(stored.loginTabId)
    }
  } catch {
    // Tab already gone -- nothing to close.
  }

  let backOnOrigin = false
  try {
    await chrome.tabs.update(stored.originTabId, { active: true })
    backOnOrigin = true
    await chrome.windows.update(stored.originWindowId, { focused: true })
  } catch {
    // The origin tab or window was closed while the user signed in.
  }

  // #526: isSignedIn() above has already awaited the accountChanged
  // broadcast, so nothing tears this enable down behind it.
  if (backOnOrigin) {
    await enableOnSignInReturn(stored.originTabId, {
      getStatus: getLearningModeStatusOnTab,
      enable: autoEnableOnSignInReturnOnTab,
    }).catch(error =>
      console.error('Failed to auto-enable the sign-in origin tab:', error)
    )
  }

  try {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
      title: 'Signed in to Catglish',
      message: 'You can keep reading — Catglish is ready.',
    })
  } catch {
    // Notifications turned off by the user or the OS.
  }

  await chrome.storage.session.remove(SIGNIN_RETURN_STORAGE_KEY)
  return { ok: true, returned: true }
}

// ADR-019 / ADR-020: the one web -> extension channel. Only enx-ui's own
// origins can reach it (also enforced by manifest `externally_connectable`,
// stamped from the same target config at build time), and the vocabulary is a
// fixed four-word list -- no message transits an internal content-script action.
const ENX_UI_ORIGINS = new Set(config.uiOrigins)

chrome.runtime.onMessageExternal.addListener(
  (message, sender, sendResponse) => {
    // Trust the browser-reported origin, never anything inside the message.
    if (!sender.origin || !ENX_UI_ORIGINS.has(sender.origin)) {
      return false
    }

    const type = (message as { type?: string } | null)?.type

    if (type === 'enx:ping') {
      sendResponse({ ok: true, version: chrome.runtime.getManifest().version })
      return false
    }

    // ADR-047 Decision 4: read-only, for /welcome's checklist. Signed-in
    // state comes from the page's own Clerk, not from here.
    if (type === 'enx:status') {
      void (async () => {
        // Answer even if Chrome can't say: the page reads a missing answer
        // as "not installed".
        const isOnToolbar = await chrome.action
          .getUserSettings()
          .then(settings => settings.isOnToolbar)
          .catch(() => false)
        sendResponse({
          ok: true,
          version: chrome.runtime.getManifest().version,
          isOnToolbar,
        })
      })()
      return true
    }

    if (type === 'enx:enable-reader') {
      void (async () => {
        if (!(await isSignedIn())) {
          sendResponse({ ok: false, reason: 'signed-out' })
          return
        }
        const tabId = sender.tab?.id
        try {
          await chrome.tabs.sendMessage(tabId!, { action: 'enxRun' })
          sendResponse({ ok: true })
        } catch (error) {
          // No content-script listener on this tab (stale extension build,
          // or the tab predates a matches-pattern change) -- surface it
          // instead of leaving the caller's callback waiting on nothing.
          sendResponse({
            ok: false,
            reason: 'no-content-script',
            message: error instanceof Error ? error.message : String(error),
          })
        }
      })()
      return true
    }

    if (type === 'enx:signed-in') {
      void (async () => {
        sendResponse(await handleSignedInReturn())
      })()
      return true
    }

    sendResponse({ ok: false, reason: 'unknown-type' })
    return false
  }
)

// Sign-in / sign-out now happen in the popup via Clerk's <SignIn/> and
// <SignOutButton/> (ADR-015); the service worker just reads the synced session.

// Handle get one word translation
// One click-to-lookup's +1 to the word's Query Count (ADR-059 Decision 3).
// Never retried: it is not idempotent, and a lost one only leaves the count
// one short. Every click uses its authoritative count (ADR-079 Decision 2).
const handleRecordWordLookup = async (wordId: string) => {
  if (!wordId) return { success: false, error: 'No word id provided' }
  const response = await makeApiRequest('/api/me/word-lookups', {
    method: 'POST',
    body: JSON.stringify({ wordId }),
  })
  if (!response.success) {
    swlog(`recordWordLookup ${wordId} failed: ${response.error}`, 'warn')
  }
  if (!response.success) return response
  return {
    success: true,
    queryCount: response.data?.queryCount,
    known: response.data?.known,
  }
}

let dictionaryCacheInstance:
  ReturnType<typeof createDictionaryCache> | undefined
let dictionaryCacheGeneration = 0
const workerDictionaryCache = () =>
  (dictionaryCacheInstance ??= createDictionaryCache(
    openDictionaryCache(indexedDB),
    Date.now,
    error => swlog(`Dictionary cache write failed: ${String(error)}`, 'warn')
  ))

const handleGetOneWord = async (word: string, refresh = false) => {
  if (!word || word.trim() === '') {
    return { success: false, error: 'No word provided' }
  }

  const generation = dictionaryCacheGeneration
  try {
    const cache = workerDictionaryCache()
    if (refresh) await cache.delete(word)
    else {
      const entry = await cache.get(word)
      if (entry)
        return {
          success: true,
          ecp: { ...entry, Key: wordKey(word.trim()) },
        }
    }
  } catch (error) {
    swlog(`Dictionary cache read failed: ${String(error)}`, 'warn')
  }
  // A read, so safe to replay (ADR-079 Decision 1): the click's one
  // recordWordLookup is what counts it.
  const response = await requestDictionaryEntries(
    [word.trim()],
    (method, path, body) =>
      makeApiRequest(path, { method, body }, { retry: true })
  )

  if (response.success) {
    const ecp = definitionFromEntries(word.trim(), response.data)
    if (!ecp) {
      swlog(`getOneWord ${word.trim()}: no definition in the answer`, 'warn')
      return { success: false, error: 'Dictionary lookup failed' }
    }
    if (generation === dictionaryCacheGeneration) {
      try {
        await workerDictionaryCache().put(word, ecp)
      } catch (error) {
        swlog(`Dictionary cache write failed: ${String(error)}`, 'warn')
      }
    }
    return { success: true, ecp }
  } else {
    console.error('API request failed:', response.error)
    // Pass through the session flags, status and code (a 429 is the daily
    // quota or the request rate limit, told apart by code -- ADR-060)
    return {
      success: false,
      error: response.error || 'Translation service error',
      sessionExpired: response.sessionExpired,
      sessionUnverified: response.sessionUnverified,
      accountGeneration: response.accountGeneration,
      status: response.status,
      code: response.code,
    }
  }
}

// The user's review list (ADR-069 Decision 1): a plain GET with no page text.
// The content script's lib/reviewList.ts retries it and checks its shape.
export const handleGetReviewWords = async () => {
  const response = await makeApiRequest('/api/me/review-words', {
    method: 'GET',
  })

  if (response.success) {
    return { success: true, reviewWords: response.data }
  } else {
    // Pass through the session flags, and what a 429 is and how long it asks
    // to wait (ADR-060): the retry in lib/reviewList.ts needs both
    return {
      success: false,
      error: response.error,
      sessionExpired: response.sessionExpired,
      sessionUnverified: response.sessionUnverified,
      accountGeneration: response.accountGeneration,
      status: response.status,
      code: response.code,
      retryAfterMs: response.retryAfterMs,
    }
  }
}

// Handle mark word as known
const handleMarkKnown = async (word: string, userId: number) => {
  if (!word) {
    console.error('handleMarkKnown: Missing word', { word })
    return { success: false, error: 'Missing word' }
  }

  console.log('handleMarkKnown: Marking word as known', {
    word: word.trim(),
    userId,
  })

  // Check if we have a Clerk session (synced from the website).
  if (!(await isSignedIn())) {
    console.error('handleMarkKnown: no Clerk session')
    return {
      success: false,
      error: 'Session expired. Please click the extension icon to login again.',
      sessionExpired: true,
    }
  }

  // Idempotent (#133): a retry after a lost reply can't undo the mark.
  const response = await makeApiRequest(
    `/api/me/words/${encodeURIComponent(word.trim())}/known`,
    { method: 'PUT' },
    { retry: true }
  )

  console.log('handleMarkKnown: API response', response)
  console.log(
    'handleMarkKnown: API response data structure:',
    JSON.stringify(response.data, null, 2)
  )

  if (response.success) {
    console.log('handleMarkKnown: Word marked successfully')
    console.log(
      'handleMarkKnown: Returning ecp data:',
      response.data?.ecp || response.data
    )
    return {
      success: true,
      ecp: response.data?.ecp || response.data,
    }
  } else {
    console.error('handleMarkKnown: Failed to mark word', response.error)
    // Pass through the session flags
    return {
      success: false,
      error: response.error,
      sessionExpired: response.sessionExpired,
      sessionUnverified: response.sessionUnverified,
      accountGeneration: response.accountGeneration,
    }
  }
}

// Handle whole-sentence AI translation for the Side Panel (spec §3.5/§3.7).
const handleTranslateSentence = async (sentence: string) => {
  if (!sentence || sentence.trim() === '') {
    return { success: false, error: 'No sentence provided' }
  }

  const response = await makeApiRequest('/api/translate/sentence', {
    method: 'POST',
    body: JSON.stringify({ sentence: sentence.trim() }),
  })

  if (response.success && response.data?.chinese) {
    return { success: true, chinese: response.data.chinese as string }
  }

  return {
    success: false,
    error: response.error || 'Translation service unavailable',
    sessionExpired: response.sessionExpired,
    sessionUnverified: response.sessionUnverified,
    accountGeneration: response.accountGeneration,
    status: response.status,
  }
}

// Handle the combined "translate the whole sentence AND gloss the clicked
// word in that sentence's context" call (ADR-014): one AI round-trip that
// backs the Side Panel opened from a word click, replacing a separate
// translateSentence + translateWordInContext pair. `wordChinese` comes back
// empty if the model omitted it -- SidePanel.tsx then falls back to a
// standalone translateWordInContext call.
const handleTranslateSentenceWithWord = async (
  sentence: string,
  word: string
) => {
  if (!sentence || sentence.trim() === '' || !word || word.trim() === '') {
    return { success: false, error: 'sentence and word are required' }
  }

  const response = await makeApiRequest('/api/translate/sentence-with-word', {
    method: 'POST',
    body: JSON.stringify({ sentence: sentence.trim(), word: word.trim() }),
  })

  if (response.success && response.data?.chinese) {
    return {
      success: true,
      chinese: response.data.chinese as string,
      wordChinese: (response.data.wordChinese as string) || '',
    }
  }

  return {
    success: false,
    error: response.error || 'Translation service unavailable',
    sessionExpired: response.sessionExpired,
    sessionUnverified: response.sessionUnverified,
    accountGeneration: response.accountGeneration,
    status: response.status,
  }
}

// Handle a single word's contextual translation for the Side Panel word-click
// flow (spec §3.7/§3.8): unlike getOneWord/ECDICT, this returns the word's
// meaning as used in the given sentence, not a generic dictionary gloss.
// dictionaryChinese is that word's dictionary definition, looked up by the
// Side Panel BEFORE sending this message (dictionary-first): it's embedded
// in the AI prompt so the model can explain (`why`) a divergence instead of
// guessing blind. Empty when the word has no dictionary entry or the lookup
// failed -- still a valid request, `why` then comes back empty too.
const handleTranslateWordInContext = async (
  sentence: string,
  word: string,
  dictionaryChinese: string
) => {
  if (!sentence || sentence.trim() === '' || !word || word.trim() === '') {
    return { success: false, error: 'sentence and word are required' }
  }

  const response = await makeApiRequest('/api/translate/word-in-context', {
    method: 'POST',
    body: JSON.stringify({
      sentence: sentence.trim(),
      word: word.trim(),
      dictionaryChinese,
    }),
  })

  if (response.success && response.data?.chinese) {
    return {
      success: true,
      chinese: response.data.chinese as string,
      why: (response.data.why as string) || '',
    }
  }

  return {
    success: false,
    error: response.error || 'Translation service unavailable',
    sessionExpired: response.sessionExpired,
    sessionUnverified: response.sessionUnverified,
    accountGeneration: response.accountGeneration,
    status: response.status,
  }
}

// Best-effort chrome.sidePanel.open() for trigger path③, called synchronously
// from the onMessage listener so it runs inside the user gesture Chrome
// forwards with a content-script runtime.sendMessage -- any `await` before
// open() spends that gesture. Opens the sending tab's own panel (ADR-050).
// Resolves true if the panel opened (or was already open: open() on an open
// panel is a harmless no-op), false if the gesture didn't forward, so the
// caller can fall back to trigger paths①/② (toolbar icon popup button /
// right-click menu), which read the same persisted context.
const openSentencePanelForGesture = (tabId?: number): Promise<boolean> => {
  if (tabId === undefined) return Promise.resolve(false)
  return openTabSidePanel(tabId)
    .then(() => true)
    .catch(error => {
      console.warn(
        'openSentencePanelForGesture: sidePanel.open() failed (expected if the gesture did not forward):',
        error
      )
      return false
    })
}

// Handle "整句翻译" (trigger path③, spec §3.2/§3.3): persist the pending sentence
// context, then report whether openSentencePanelForGesture() (fired earlier by
// the onMessage listener) managed to open the panel.
//
// If the tab's Side Panel is *already* open we don't need a user gesture at
// all: SidePanel.tsx re-reads the tab's pending-sentence key on
// storage.onChanged and refreshes in place (spec §4.6). We detect that via
// chrome.runtime.getContexts (isTabSidePanelOpen) and report panelOpened:true
// so the caller suppresses the "click the toolbar icon" hint.
const handleOpenSentencePanel = async (
  tabId: number | undefined,
  word: string,
  sentence: string,
  phrase?: string,
  panelOpening?: Promise<boolean>,
  wordStates?: Record<string, WordData>
) => {
  // A panel belongs to a tab (ADR-050); without one there's nowhere to show it.
  if (tabId === undefined) return { success: false, error: 'No sender tab' }

  const context: PendingSentenceContext = {
    word,
    sentence,
    phrase,
    createdAt: Date.now(),
    wordStates,
  }
  await chrome.storage.session.set({ [pendingSentenceKey(tabId)]: context })

  // The onMessage listener already fired sidePanel.open() inside the forwarded
  // gesture; await its outcome here. Fall back to a getContexts() probe in case
  // open() rejected but the panel is in fact already open -- SidePanel.tsx then
  // picks up the new context via storage.onChanged (spec §4.6) and no hint is
  // needed.
  let panelOpened = panelOpening ? await panelOpening : false
  if (!panelOpened) {
    panelOpened = await isTabSidePanelOpen(tabId)
  }

  return { success: true, panelOpened }
}

// Mirrors a page-level word popover lookup into the Side Panel's word list
// (ADR-006). Content scripts can't write chrome.storage.session directly
// (no access unless the background grants TRUSTED_AND_UNTRUSTED_CONTEXTS,
// which would also expose other session keys like the OAuth verifier to
// arbitrary web pages), so this proxies the write the same way
// handleOpenSentencePanel does for the pending-sentence key. Written under the
// sending tab's key (ADR-050), so only that tab's panel shows it. Overwrite
// only -- no history -- and deliberately never touches the pending-sentence
// key or calls chrome.sidePanel.open().
const handleRecordPageWordLookup = async (
  tabId: number | undefined,
  word: string,
  ecp?: WordData
) => {
  if (tabId === undefined) return { success: false, error: 'No sender tab' }
  if (!word || !ecp)
    return { success: false, error: 'Missing word or dictionary data' }

  const lookup: LatestPageWordLookup = { word, ecp, createdAt: Date.now() }
  await chrome.storage.session.set({ [latestPageWordKey(tabId)]: lookup })

  return { success: true }
}

// L0 reading statistics (ADR-028). The content script owns the watermark and
// hands over only a delta; the background owns getting it to the server,
// because it is the only context with a Clerk token and the only one that
// outlives the page. Reports are queued, so this resolving does not mean the
// server has it -- and deliberately so: the reading UI must never wait on a
// statistics round trip.
const handleReportReadingProgress = async (delta?: StatsDelta) => {
  if (!delta) return { success: false, error: 'Missing delta' }
  if (!(await isSignedIn())) return { success: true, queued: false }

  await enqueueReport(delta, makeApiRequest)
  return { success: true, queued: true }
}

// A page the user confirmed they want reported (ADR-010 Decision 8), sent as
// a page_report feedback record (ADR-076). Unlike the stats queue this is NOT
// fire-and-forget: the popup shows the user whether it went through, and a
// report they clicked "send" on is not silently dropped.
const handleSubmitPageReport = async (report?: {
  url: string
  reason: string
  adapter: string
}) => {
  if (!report?.url) return { success: false, error: 'Missing report' }
  return await makeApiRequest('/api/feedback', {
    method: 'POST',
    body: JSON.stringify({
      kind: 'page_report',
      url: report.url,
      context: {
        adapter: report.adapter,
        extVersion: chrome.runtime.getManifest().version,
      },
      details: { reason: report.reason },
    }),
  })
}

// The popup's "Send feedback" (ADR-076), sent as a text feedback record. An
// empty URL means the user sends it without a page. The context is copied
// field by field, so nothing else the message carries reaches the server.
// A failure keeps the API's status and message: the popup shows a 400's or
// 429's message and its own fallback for anything else.
const handleSubmitFeedback = async (feedback?: FeedbackSubmission) => {
  if (!feedback?.text) return { success: false, error: 'Missing feedback' }
  const { context } = feedback
  return await makeApiRequest('/api/feedback', {
    method: 'POST',
    body: JSON.stringify({
      kind: 'text',
      url: feedback.url ?? '',
      text: feedback.text,
      context: {
        appVersion: chrome.runtime.getManifest().version,
        browser: context?.browser,
        learningMode: context?.learningMode,
        adapter: context?.adapter,
        articleSource: context?.articleSource,
      },
      details: {},
    }),
  })
}

// A confirmed article choice the user agreed to share (ADR-073 decision 5),
// sent as an article_choice feedback record. Fields are copied one by one,
// so nothing else the message carries reaches the server.
const handleSubmitArticleChoice = async (choice?: ArticleChoiceReport) => {
  if (!choice?.url || !choice.selector)
    return { success: false, error: 'Missing article choice' }
  return await makeApiRequest('/api/feedback', {
    method: 'POST',
    body: JSON.stringify({
      kind: 'article_choice',
      url: choice.url,
      context: {
        adapter: choice.adapter,
        extVersion: chrome.runtime.getManifest().version,
      },
      details: {
        selector: choice.selector,
        autoSource: choice.autoSource,
        autoSelector: choice.autoSelector,
        autoPlatform: choice.autoPlatform,
      },
    }),
  })
}

// A page the user chose to save (ADR-032). Like the page report it is not
// fire-and-forget: the popup shows the user whether it was saved, and shows
// the server's own message when it was not (limit reached, address too long).
// POST /api/dictionary/ai-word. The server validates the word, the user's
// entitlement and credit, and does the billing; this only refuses a message
// with no usable word so it never becomes a request.
const handleDefineWordWithAI = async (word: unknown) => {
  if (typeof word !== 'string' || word.trim() === '') {
    return { success: false, error: 'No word provided' }
  }
  return await makeApiRequest('/api/dictionary/ai-word', {
    method: 'POST',
    body: JSON.stringify({ word: word.trim() }),
  })
}

// PUT /api/me/preferences with a partial change -- { key: true | false | null },
// null returning the key to its default. The server validates the keys and
// the user's entitlement; this only refuses a body that is not an object, so
// a malformed message never becomes a request.
const handleUpdatePreferences = async (changes: unknown) => {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
    return { success: false, error: 'No preference changes were provided' }
  }
  return await makeApiRequest('/api/me/preferences', {
    method: 'PUT',
    body: JSON.stringify(changes),
  })
}

const handleSavePage = async (page?: { url: string; title: string }) => {
  if (!page?.url) return { success: false, error: 'Missing page' }
  return await makeApiRequest('/api/saved-pages', {
    method: 'POST',
    body: JSON.stringify({ url: page.url, title: page.title }),
  })
}

const handleRemoveSavedPage = async (id?: string) => {
  if (!id) return { success: false, error: 'Missing saved page' }
  return await makeApiRequest(`/api/saved-pages/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

// Handle service worker errors
self.addEventListener('error', event => {
  console.error('ENX Service worker error:', event.error)
})

// Handle unhandled promise rejections
self.addEventListener('unhandledrejection', event => {
  console.error('ENX Unhandled promise rejection:', event.reason)
})

// Initialize background script
const initialize = async () => {
  await getClerk()
  // A worker wake-up is the only reliable moment to retry reports stranded
  // by the eviction that ended the previous instance. Fire-and-forget: a
  // failed drain must not hold up the worker the reading path depends on.
  if (await isSignedIn()) {
    void flushQueue(makeApiRequest)
  }
  console.log('ENX Background script initialization complete')
}

initialize()
