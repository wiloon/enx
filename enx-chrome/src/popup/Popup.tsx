import DebugPanel from '@/components/DebugPanel'
import CatglishLogo from '@/components/CatglishLogo'
import LearningModeCard, {
  type LearningModeCardStatus,
} from '@/components/LearningModeCard'
import Login from '@/components/Login'
import { useAutoEnableSite } from '@/hooks/useAutoEnableSite'
import { useInitializeStorage } from '@/hooks/useInitializeStorage'
import { useSavedPage } from '@/hooks/useSavedPage'
import { useWordHighlightEnabled } from '@/hooks/useWordHighlightEnabled'
import '@/index.css'
import PageReportPrompt, {
  PageReportStatus,
} from '@/components/PageReportPrompt'
import SaveLinkCard from '@/components/SaveLinkCard'
import { config } from '@/config/env'
import { isReportableFailure, EnableFailureReason } from '@/lib/enableOutcome'
import {
  disableLearningModeOnTab,
  enableLearningModeOnTab,
  getLearningModeStatusOnTab,
} from '@/lib/enableLearningMode'
import { PageReportPayload, sanitizePageUrl } from '@/lib/pageReport'
import { initSentry } from '@/lib/sentry'
import { openActiveTabSidePanel } from '@/lib/sidePanel'
import { errorAtom, userAtom } from '@/store/atoms'
import { ClerkProvider, SignOutButton, useUser } from '@clerk/chrome-extension'
import {
  ArrowRightOnRectangleIcon,
  BookOpenIcon,
  ChevronRightIcon,
  Cog6ToothIcon,
  GlobeAltIcon,
} from '@heroicons/react/24/outline'
import { Provider, useAtom, useSetAtom } from 'jotai'
import { useEffect, useState } from 'react'

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

// Mirror the Clerk session into userAtom (ADR-015) so the rest of the popup
// (DebugPanel, etc.) can keep reading user.isLoggedIn / user.username.
function ClerkUserSync() {
  const { isLoaded, isSignedIn, user } = useUser()
  const setUser = useSetAtom(userAtom)

  useEffect(() => {
    if (!isLoaded) return
    if (isSignedIn && user) {
      setUser({
        id: 0,
        username:
          user.fullName ||
          user.username ||
          user.primaryEmailAddress?.emailAddress ||
          'user',
        email: user.primaryEmailAddress?.emailAddress || '',
        isLoggedIn: true,
      })
    } else {
      setUser({ id: 0, username: '', email: '', isLoggedIn: false })
    }
  }, [isLoaded, isSignedIn, user, setUser])

  return null
}

function Header() {
  const openOptions = () => {
    chrome.runtime.openOptionsPage()
  }

  return (
    <header className="flex items-center gap-2.5 border-b border-border bg-background px-4 py-3">
      <CatglishLogo className="h-8 w-8 shrink-0" />
      <div className="flex-1 leading-tight">
        <p className="text-sm font-semibold text-foreground">Catglish</p>
        <p className="text-[11px] text-muted-foreground">
          English Reading Assistant
        </p>
      </div>
      <button
        type="button"
        onClick={openOptions}
        title="Settings"
        aria-label="Settings"
        className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
      >
        <Cog6ToothIcon className="h-[18px] w-[18px]" />
      </button>
    </header>
  )
}

interface SignedInBodyProps {
  wordHighlightEnabled: boolean
  setWordHighlightEnabled: (value: boolean) => void
}

function SignedInBody({
  wordHighlightEnabled,
  setWordHighlightEnabled,
}: SignedInBodyProps) {
  const { user } = useUser()
  const autoEnableSite = useAutoEnableSite()
  const [error, setError] = useAtom(errorAtom)
  const [learningStatus, setLearningStatus] =
    useState<LearningModeCardStatus>('off')

  // Start from the page's real state: an auto-enabled site, or a page enabled
  // from an earlier popup, is already on before this button is ever clicked.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      })
      if (!tab?.id) return
      const { status } = await getLearningModeStatusOnTab(tab.id)
      if (cancelled) return
      // Not 'processing': the popup would never hear it finish and the
      // button would stay disabled.
      if (status === 'ready') setLearningStatus('on')
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const displayName =
    user?.fullName ||
    user?.username ||
    user?.primaryEmailAddress?.emailAddress ||
    'there'
  const email = user?.primaryEmailAddress?.emailAddress || ''
  const initial = (displayName || 'U').trim().charAt(0).toUpperCase()

  // Set only after a failure on a page we could not read; the user decides
  // whether it is sent (ADR-010 Decision 8).
  const [reportCandidate, setReportCandidate] =
    useState<PageReportPayload | null>(null)
  const [reportStatus, setReportStatus] = useState<PageReportStatus>('idle')

  const handleSendReport = async () => {
    if (!reportCandidate) return
    setReportStatus('sending')
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'submitPageReport',
        pageReport: reportCandidate,
      })
      setReportStatus(response?.success ? 'sent' : 'failed')
    } catch {
      setReportStatus('failed')
    }
  }

  // Saving (收藏) the current tab's link: one click, with the address in view
  // (ADR-032 Decision 4/4a).
  const savedPage = useSavedPage(user?.id)

  const handleEnableLearning = async () => {
    setLearningStatus('enabling')
    setError(null)
    setReportCandidate(null)
    setReportStatus('idle')
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
        // Only failures that say "this page's layout defeated us" are worth
        // offering; a network error or expired session is not the page's fault.
        const reason = response?.reason as EnableFailureReason | undefined
        const url = sanitizePageUrl(tab.url)
        if (reason && isReportableFailure(reason) && url) {
          setReportCandidate({ url, reason, adapter: response.adapter ?? '' })
        }
        throw new Error(response?.error || "Couldn't turn on Catglish")
      }
      setLearningStatus('on')
    } catch (e) {
      // enableLearningModeOnTab already turns "no content script yet" into an
      // inject-and-retry, so anything still thrown here is a genuine failure
      // (no active tab, or the injected/retried enxRun call itself rejected).
      const message = e instanceof Error ? e.message : ''
      setError(message || "Couldn't turn on Catglish on this page")
      setLearningStatus('off')
    }
  }

  // Leaves the page as it was before learning mode, without a reload. On an
  // auto-enabled site this lasts until the next page load; the site toggle
  // below is what stops it for good.
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

  // Trigger path① (spec §3.2): a click inside the popup is a real, unforwarded
  // user gesture, so sidePanel.open() here is reliable -- unlike forwarding a
  // content script's click through runtime.sendMessage (trigger path③). Kept
  // as an explicit button rather than switching openPanelOnActionClick, so
  // popup.html (and its login/logout flow) stays reachable by left-clicking
  // the toolbar icon. Opens the current tab's own panel (ADR-050).
  const handleOpenSentencePanel = async () => {
    try {
      await openActiveTabSidePanel()
    } catch (err) {
      console.error('Failed to open side panel from popup:', err)
    }
  }

  return (
    <div className="space-y-2.5 p-3">
      <div className="flex items-center gap-3 rounded-xl bg-background p-3 shadow-xs ring-1 ring-border">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-semibold text-brand-foreground">
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
        {/*
          `redirectUrl` defaults to "/" in <SignOutButton>, which after sign-out
          navigates the popup to chrome-extension://<id>/ -- a directory with no
          index, so Chrome shows ERR_FILE_NOT_FOUND. It also shadows the
          ClerkProvider `afterSignOutUrl`, so set it here explicitly back to the
          popup page.
        */}
        <SignOutButton redirectUrl="/popup.html">
          <button
            type="button"
            title="Sign out"
            aria-label="Sign out"
            className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <ArrowRightOnRectangleIcon className="h-[18px] w-[18px]" />
          </button>
        </SignOutButton>
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
          onSend={handleSendReport}
          onDismiss={() => setReportCandidate(null)}
        />
      )}

      <LearningModeCard
        status={learningStatus}
        onEnable={handleEnableLearning}
        onTurnOff={handleTurnOffLearning}
      />

      {/* adr-039: only on pages whose site can be auto-enabled. */}
      {autoEnableSite.site && (
        <label className="flex cursor-pointer items-center gap-3 rounded-xl bg-background px-3 py-2.5 shadow-xs ring-1 ring-border">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-muted text-brand">
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
          <span className="relative inline-flex shrink-0 items-center">
            <input
              type="checkbox"
              data-testid="popup-auto-enable-site-toggle"
              checked={autoEnableSite.enabled}
              onChange={e => void autoEnableSite.setEnabled(e.target.checked)}
              className="peer sr-only"
            />
            <span className="block h-5 w-9 rounded-full bg-border transition peer-checked:bg-brand peer-focus-visible:ring-2 peer-focus-visible:ring-brand peer-focus-visible:ring-offset-1" />
            <span className="pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-background shadow-sm transition peer-checked:translate-x-4" />
          </span>
        </label>
      )}

      <label className="flex cursor-pointer items-center gap-3 rounded-xl bg-background px-3 py-2.5 shadow-xs ring-1 ring-border">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-muted text-brand">
          <BookOpenIcon className="h-[18px] w-[18px]" />
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block text-sm font-medium text-foreground">
            Highlight looked-up words
          </span>
          <span className="block text-[11px] text-muted-foreground">
            Underline the words you&apos;ve looked up
          </span>
        </span>
        <span className="relative inline-flex shrink-0 items-center">
          <input
            type="checkbox"
            data-testid="popup-word-highlight-toggle"
            checked={wordHighlightEnabled}
            onChange={e => setWordHighlightEnabled(e.target.checked)}
            className="peer sr-only"
          />
          <span className="block h-5 w-9 rounded-full bg-border transition peer-checked:bg-brand peer-focus-visible:ring-2 peer-focus-visible:ring-brand peer-focus-visible:ring-offset-1" />
          <span className="pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-background shadow-sm transition peer-checked:translate-x-4" />
        </span>
      </label>

      <button
        type="button"
        data-testid="popup-open-sentence-panel"
        onClick={handleOpenSentencePanel}
        className="flex w-full items-center gap-3 rounded-xl bg-background px-3 py-2.5 text-left shadow-xs ring-1 ring-border transition hover:ring-brand/50"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-muted text-brand">
          <SidePanelIcon className="h-[18px] w-[18px]" />
        </span>
        <span className="flex-1 text-sm font-medium text-foreground">
          Open side panel
        </span>
        <ChevronRightIcon className="h-4 w-4 text-muted-foreground" />
      </button>

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
    </div>
  )
}

function PopupContent() {
  const { enabled: wordHighlightEnabled, setEnabled: setWordHighlightEnabled } =
    useWordHighlightEnabled()

  useInitializeStorage()

  const handleLoginSuccess = () => {
    console.log('Login successful')
  }

  return (
    <div className="w-[340px] bg-muted font-sans text-foreground antialiased">
      <ClerkUserSync />
      <Header />
      <div className="min-h-[180px]">
        <Login onLoginSuccess={handleLoginSuccess}>
          <SignedInBody
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
    </div>
  )
}

export default function Popup() {
  return (
    <ClerkProvider
      publishableKey={config.clerkPublishableKey}
      syncHost={config.clerkSyncHost}
      // Pick up a session change on the website (e.g. the user just signed in
      // there) without needing to reopen the popup.
      __experimental_syncHostListener
      afterSignOutUrl="/popup.html"
    >
      <Provider>
        <PopupContent />
      </Provider>
    </ClerkProvider>
  )
}
