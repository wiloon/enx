import ArticleChoiceControl from '@/components/ArticleChoiceControl'
import DebugPanel from '@/components/DebugPanel'
import LearningModeCard, {
  type LearningModeCardStatus,
} from '@/components/LearningModeCard'
import Login from '@/components/Login'
import { useActiveTabSidePanel } from '@/hooks/useActiveTabSidePanel'
import { useAutoEnableSite } from '@/hooks/useAutoEnableSite'
import { useSavedPage } from '@/hooks/useSavedPage'
import { useWordHighlightEnabled } from '@/hooks/useWordHighlightEnabled'
import '@/index.css'
import PopupHeader from '@/components/PopupHeader'
import PopupStatsSection from '@/components/PopupStatsSection'
import PopupVersion from '@/components/PopupVersion'
import PageReportPrompt, {
  PageReportStatus,
} from '@/components/PageReportPrompt'
import SaveLinkCard from '@/components/SaveLinkCard'
import SendFeedback from '@/components/SendFeedback'
import SignOutButton from '@/components/SignOutButton'
import { config } from '@/config/env'
import {
  isReportableFailure,
  type EnableFailureReason,
} from '@/lib/enableOutcome'
import {
  disableLearningModeOnTab,
  enableLearningModeOnTab,
  getLearningModeStatusOnTab,
} from '@/lib/enableLearningMode'
import {
  showsPopupLearningCardWhenSignedOut,
  type LearningAccess,
} from '@/lib/learningAccess'
import {
  learningModeShortcut,
  openShortcutSettings,
  type LearningModeShortcut,
} from '@/lib/learningModeCommand'
import { isLearningModeOn } from '@/lib/learningModeStatus'
import {
  PageReportPayload,
  sanitizePageUrl,
  sendPageReport,
} from '@/lib/pageReport'
import { initSentry } from '@/lib/sentry'
import { useAuthSession } from '@/lib/auth'
import { selectPopupAuth } from '@/lib/auth/selectPopupAuth'
import { errorAtom, userAtom } from '@/store/atoms'
import {
  ChevronRightIcon,
  GlobeAltIcon,
  UnderlineIcon,
} from '@heroicons/react/24/outline'
import { Provider, useAtom, useSetAtom } from 'jotai'
import { type ReactNode, useEffect, useState } from 'react'

const popupAuth = selectPopupAuth(config.auth)

initSentry()

// heroicons has no side-panel glyph: a window whose right column is filled,
// drawn in the same 24px / 1.5 stroke style as the outline set.
function SidePanelIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden="true"
      className={className}
    >
      <path
        d="M14.25 4.5h4.5A2.25 2.25 0 0 1 21 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-4.5z"
        fill="currentColor"
        fillOpacity={0.3}
        stroke="none"
      />
      <rect x="3" y="4.5" width="18" height="15" rx="2.25" />
      <path d="M14.25 4.5v15" />
    </svg>
  )
}

// One row of the popup's settings group; the group draws the frame.
const settingRowClass = 'flex cursor-pointer items-center gap-3 px-3 py-2'
const settingIconClass =
  'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-muted text-brand'

function Switch({
  testId,
  checked,
  onChange,
}: {
  testId: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <span className="relative inline-flex shrink-0 items-center">
      <input
        type="checkbox"
        data-testid={testId}
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span className="block h-5 w-9 rounded-full bg-border transition peer-checked:bg-brand peer-focus-visible:ring-2 peer-focus-visible:ring-brand peer-focus-visible:ring-offset-1" />
      <span className="pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-background shadow-sm transition peer-checked:translate-x-4" />
    </span>
  )
}

// Mirror the auth session into userAtom (ADR-015) so the rest of the popup
// (DebugPanel, etc.) can keep reading user.isLoggedIn / user.username.
function AuthUserSync() {
  const { isLoaded, isSignedIn, user } = useAuthSession()
  const setUser = useSetAtom(userAtom)

  useEffect(() => {
    if (!isLoaded) return
    if (isSignedIn && user) {
      setUser({
        id: 0,
        username: user.fullName || user.username || user.primaryEmail || 'user',
        email: user.primaryEmail || '',
        isLoggedIn: true,
      })
    } else {
      setUser({ id: 0, username: '', email: '', isLoggedIn: false })
    }
  }, [isLoaded, isSignedIn, user, setUser])

  return null
}

// Shared by the signed-in body and the anonymous popup (ADR-095): status,
// shortcut, and turning learning mode on or off for the active tab.
function usePopupLearningMode(options?: {
  onEnableFailure?: (
    tab: chrome.tabs.Tab,
    response: {
      reason?: EnableFailureReason
      adapter?: string
      error?: string
    }
  ) => void
}) {
  const [error, setError] = useAtom(errorAtom)
  const [learningStatus, setLearningStatus] =
    useState<LearningModeCardStatus>('off')
  const [shortcut, setShortcut] = useState<LearningModeShortcut>()

  useEffect(() => {
    chrome.commands
      .getAll()
      .then(commands => setShortcut(learningModeShortcut(commands)))
      .catch(err => console.warn('Failed to read the shortcut:', err))
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      })
      if (!tab?.id) return
      const status = await getLearningModeStatusOnTab(tab.id)
      if (cancelled) return
      if (isLearningModeOn(status)) setLearningStatus('on')
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const handleEnableLearning = async () => {
    setLearningStatus('enabling')
    setError(null)
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      })
      if (!tab?.id) {
        throw new Error('No active tab found')
      }
      const response = await enableLearningModeOnTab(tab.id)
      if (!response?.success) {
        options?.onEnableFailure?.(tab, response ?? {})
        throw new Error(response?.error || "Couldn't turn on Catglish")
      }
      setLearningStatus('on')
    } catch (e) {
      const message = e instanceof Error ? e.message : ''
      setError(message || "Couldn't turn on Catglish on this page")
      setLearningStatus('off')
    }
  }

  const handleTurnOffLearning = async () => {
    setLearningStatus('turning-off')
    setError(null)
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      })
      if (tab?.id) await disableLearningModeOnTab(tab.id)
      setLearningStatus('off')
    } catch (e) {
      const message = e instanceof Error ? e.message : ''
      setError(message || "Couldn't turn off Catglish on this page")
      setLearningStatus('on')
    }
  }

  return {
    error,
    setError,
    learningStatus,
    setLearningStatus,
    shortcut,
    handleEnableLearning,
    handleTurnOffLearning,
  }
}

// ADR-095: above the sign-in card; no stats, save page or feedback.
function AnonymousLearningMode() {
  const {
    error,
    learningStatus,
    shortcut,
    handleEnableLearning,
    handleTurnOffLearning,
  } = usePopupLearningMode()

  return (
    <div className="space-y-2 p-3 pb-0">
      {error && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}
      <LearningModeCard
        status={learningStatus}
        shortcut={shortcut}
        onEnable={() => void handleEnableLearning()}
        onTurnOff={() => void handleTurnOffLearning()}
        onSetShortcut={() => void openShortcutSettings(chrome.tabs)}
      />
    </div>
  )
}

interface SignedInBodyProps {
  footerEnd: ReactNode
  wordHighlightEnabled: boolean
  setWordHighlightEnabled: (value: boolean) => void
}

function SignedInBody({
  footerEnd,
  wordHighlightEnabled,
  setWordHighlightEnabled,
}: SignedInBodyProps) {
  const { user } = useAuthSession()
  const autoEnableSite = useAutoEnableSite()
  // Trigger path① (spec §3.2): a click inside the popup is a real, unforwarded
  // user gesture, so sidePanel.open() here is reliable -- unlike forwarding a
  // content script's click through runtime.sendMessage (trigger path③). Kept
  // as an explicit button rather than switching openPanelOnActionClick, so
  // popup.html (and its login/logout flow) stays reachable by left-clicking
  // the toolbar icon. Toggles the current tab's own panel (ADR-050).
  const sidePanel = useActiveTabSidePanel()

  // Set only after a failure on a page we could not read; the user decides
  // whether it is sent (ADR-010 Decision 8).
  const [reportCandidate, setReportCandidate] =
    useState<PageReportPayload | null>(null)
  const [reportStatus, setReportStatus] = useState<PageReportStatus>('idle')
  const [reportError, setReportError] = useState<string>()

  const {
    error,
    learningStatus,
    setLearningStatus,
    shortcut,
    handleEnableLearning,
    handleTurnOffLearning,
  } = usePopupLearningMode({
    onEnableFailure: (tab, response) => {
      setReportCandidate(null)
      setReportStatus('idle')
      const reason = response.reason
      const url = sanitizePageUrl(tab.url)
      if (reason && isReportableFailure(reason) && url) {
        setReportCandidate({ url, reason, adapter: response.adapter ?? '' })
      }
    },
  })

  const displayName =
    user?.fullName || user?.username || user?.primaryEmail || 'there'
  const email = user?.primaryEmail || ''
  const initial = (displayName || 'U').trim().charAt(0).toUpperCase()

  const handleSendReport = async () => {
    if (!reportCandidate) return
    setReportStatus('sending')
    const outcome = await sendPageReport(
      message => chrome.runtime.sendMessage(message),
      reportCandidate
    )
    setReportError(outcome.sent ? undefined : outcome.message)
    setReportStatus(outcome.sent ? 'sent' : 'failed')
  }

  // Saving (收藏) the current tab's link: one click, with the address in view
  // (ADR-032 Decision 4/4a). Subject comes from the selected auth adapter.
  const savedPage = useSavedPage(user?.id)

  const onEnable = async () => {
    setReportCandidate(null)
    setReportStatus('idle')
    await handleEnableLearning()
  }

  return (
    <SendFeedback footerEnd={footerEnd}>
      <PopupStatsSection />

      <div className="flex items-center gap-3 rounded-xl bg-background px-3 py-2 shadow-xs ring-1 ring-border">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-semibold text-brand-foreground">
          {initial}
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm font-medium text-foreground">
            {displayName}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            {email || 'Signed in'}
          </p>
        </div>
        <SignOutButton />
      </div>

      {error && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}

      {reportCandidate && (
        <PageReportPrompt
          url={reportCandidate.url}
          status={reportStatus}
          errorMessage={reportError}
          onSend={handleSendReport}
          onDismiss={() => setReportCandidate(null)}
        />
      )}

      <LearningModeCard
        status={learningStatus}
        shortcut={shortcut}
        onEnable={() => void onEnable()}
        onTurnOff={() => void handleTurnOffLearning()}
        onSetShortcut={() => void openShortcutSettings(chrome.tabs)}
      />

      {/* The page's settings share one frame with a divider between rows, so
          the main page fits Chrome's 600px popup without a scrollbar. */}
      <div className="divide-y divide-border overflow-hidden rounded-xl bg-background shadow-xs ring-1 ring-border">
        {/* adr-039: only on pages whose site can be auto-enabled. */}
        {autoEnableSite.site && (
          <label className={settingRowClass}>
            <span className={settingIconClass}>
              <GlobeAltIcon className="h-[18px] w-[18px]" />
            </span>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block text-sm font-medium text-foreground">
                Always enable on this site
              </span>
              <span className="block truncate text-[11px] text-muted-foreground">
                {autoEnableSite.host}
              </span>
            </span>
            <Switch
              testId="popup-auto-enable-site-toggle"
              checked={autoEnableSite.enabled}
              onChange={checked => void autoEnableSite.setEnabled(checked)}
            />
          </label>
        )}

        <label className={settingRowClass}>
          <span className={settingIconClass}>
            <UnderlineIcon className="h-[18px] w-[18px]" />
          </span>
          <span className="min-w-0 flex-1 text-sm font-medium text-foreground">
            Highlight looked-up words
          </span>
          <Switch
            testId="popup-word-highlight-toggle"
            checked={wordHighlightEnabled}
            onChange={setWordHighlightEnabled}
          />
        </label>

        <button
          type="button"
          data-testid="popup-open-sentence-panel"
          aria-pressed={sidePanel.open}
          onClick={() => void sidePanel.toggle()}
          className={`${settingRowClass} w-full text-left transition hover:bg-muted/60 active:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand`}
        >
          <span className={settingIconClass}>
            <SidePanelIcon className="h-[18px] w-[18px]" />
          </span>
          <span className="flex-1 text-sm font-medium text-foreground">
            {sidePanel.open ? 'Close side panel' : 'Open side panel'}
          </span>
          <ChevronRightIcon className="h-4 w-4 text-muted-foreground" />
        </button>

        {/* Last: choosing the article by hand is the least used setting. */}
        <ArticleChoiceControl
          onModeChange={() => {
            void chrome.tabs
              .query({ active: true, currentWindow: true })
              .then(async ([tab]) => {
                if (!tab?.id) return
                const status = await getLearningModeStatusOnTab(tab.id)
                setLearningStatus(isLearningModeOn(status) ? 'on' : 'off')
              })
          }}
        />
      </div>

      {savedPage.tab && (
        <SaveLinkCard
          url={savedPage.tab.url}
          saved={savedPage.saved !== null}
          busy={savedPage.busy}
          error={savedPage.error}
          savedListUrl={`${config.frontendBaseUrl}/saved`}
          onSave={() => void savedPage.save()}
          onRemove={() => void savedPage.remove()}
        />
      )}
    </SendFeedback>
  )
}

function PopupContent() {
  const { isLoaded, isSignedIn } = useAuthSession()
  const { enabled: wordHighlightEnabled, setEnabled: setWordHighlightEnabled } =
    useWordHighlightEnabled()
  // ADR-095: only a never-signed-in browser shows "Read with Catglish" above
  // the sign-in card; a prior sign-in keeps today's signed-out popup.
  const [signedOutAccess, setSignedOutAccess] = useState<LearningAccess | null>(
    null
  )

  useEffect(() => {
    if (!isLoaded || isSignedIn) return
    let cancelled = false
    void chrome.runtime
      .sendMessage({ type: 'learningAccess' })
      .then((reply: { access?: LearningAccess } | undefined) => {
        if (cancelled) return
        setSignedOutAccess(reply?.access ?? 'signed-out')
      })
      .catch(() => {
        if (!cancelled) setSignedOutAccess('signed-out')
      })
    return () => {
      cancelled = true
    }
  }, [isLoaded, isSignedIn])

  const showAnonymousLearning =
    isLoaded &&
    !isSignedIn &&
    signedOutAccess !== null &&
    showsPopupLearningCardWhenSignedOut(signedOutAccess)

  const versionFooter = (
    <PopupVersion
      inline={!!isSignedIn}
      build={{
        version: chrome.runtime.getManifest().version,
        environment: config.environment,
        commit: config.buildCommit,
        builtAt: config.builtAt,
      }}
      copy={text => navigator.clipboard.writeText(text)}
    />
  )

  const handleLoginSuccess = () => {
    console.log('Login successful')
  }

  return (
    <div className="w-[340px] bg-muted font-sans text-foreground antialiased">
      <AuthUserSync />
      <PopupHeader />
      <div className="min-h-[180px]">
        <Login
          onLoginSuccess={handleLoginSuccess}
          beforeSignIn={
            showAnonymousLearning ? <AnonymousLearningMode /> : null
          }
        >
          <SignedInBody
            footerEnd={versionFooter}
            wordHighlightEnabled={wordHighlightEnabled}
            setWordHighlightEnabled={setWordHighlightEnabled}
          />
        </Login>
      </div>
      {process.env.NODE_ENV === 'development' && (
        <div className="px-3 pb-3">
          <DebugPanel />
        </div>
      )}
      {/* Signed-out users can still read the version off. */}
      {!isSignedIn && versionFooter}
    </div>
  )
}

export default function Popup() {
  return (
    <popupAuth.Provider>
      <Provider>
        <PopupContent />
      </Provider>
    </popupAuth.Provider>
  )
}
