import DebugPanel from '@/components/DebugPanel'
import Login from '@/components/Login'
import { useInitializeStorage } from '@/hooks/useInitializeStorage'
import { useWordHighlightEnabled } from '@/hooks/useWordHighlightEnabled'
import '@/index.css'
import { config } from '@/config/env'
import { initSentry } from '@/lib/sentry'
import { errorAtom, userAtom } from '@/store/atoms'
import { ClerkProvider, SignOutButton, useUser } from '@clerk/chrome-extension'
import {
  AcademicCapIcon,
  ArrowRightOnRectangleIcon,
  BookOpenIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  Cog6ToothIcon,
  LanguageIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline'
import { Provider, useAtom, useSetAtom } from 'jotai'
import { useEffect, useState } from 'react'

initSentry()

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
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-brand-foreground">
        <AcademicCapIcon className="h-[18px] w-[18px]" />
      </div>
      <div className="flex-1 leading-tight">
        <p className="text-sm font-semibold text-foreground">ENX</p>
        <p className="text-[11px] text-muted-foreground">English Reading Assistant</p>
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
  const [error, setError] = useAtom(errorAtom)
  const [learningStatus, setLearningStatus] = useState<
    'idle' | 'processing' | 'completed'
  >('idle')

  const displayName =
    user?.fullName ||
    user?.username ||
    user?.primaryEmailAddress?.emailAddress ||
    'there'
  const email = user?.primaryEmailAddress?.emailAddress || ''
  const initial = (displayName || 'U').trim().charAt(0).toUpperCase()

  const handleEnableLearning = async () => {
    setLearningStatus('processing')
    setError(null)
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      })
      if (!tab?.id) {
        throw new Error('No active tab found')
      }
      const response = await chrome.tabs.sendMessage(tab.id, {
        action: 'enxRun',
      })
      if (!response?.success) {
        throw new Error(response?.error || 'Failed to enable learning mode')
      }
      setLearningStatus('completed')
    } catch (e) {
      const message = e instanceof Error ? e.message : ''
      setError(
        message.includes('Receiving end does not exist')
          ? 'No content script on this tab. Reload the extension at chrome://extensions, then refresh this page.'
          : message || 'Cannot enable learning mode on this page'
      )
      setLearningStatus('idle')
    }
  }

  // Trigger path① (spec §3.2): a click inside the popup is a real, unforwarded
  // user gesture, so sidePanel.open() here is reliable -- unlike forwarding a
  // content script's click through runtime.sendMessage (trigger path③). Kept
  // as an explicit button rather than switching openPanelOnActionClick, so
  // popup.html (and its login/logout flow) stays reachable by left-clicking
  // the toolbar icon.
  const handleOpenSentencePanel = async () => {
    try {
      const win = await chrome.windows.getCurrent()
      if (win.id !== undefined) {
        await chrome.sidePanel.open({ windowId: win.id })
      }
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

      <button
        type="button"
        onClick={handleEnableLearning}
        disabled={learningStatus === 'processing'}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-2.5 text-sm font-semibold text-brand-foreground shadow-md shadow-brand/25 transition hover:brightness-105 active:scale-[0.99] disabled:opacity-60"
      >
        {learningStatus === 'completed' ? (
          <CheckCircleIcon className="h-[18px] w-[18px]" />
        ) : (
          <SparklesIcon className="h-[18px] w-[18px]" />
        )}
        {learningStatus === 'processing'
          ? 'Enabling…'
          : learningStatus === 'completed'
            ? 'Learning mode enabled'
            : 'Enable learning mode'}
      </button>

      <button
        type="button"
        data-testid="popup-open-sentence-panel"
        onClick={handleOpenSentencePanel}
        className="flex w-full items-center gap-3 rounded-xl bg-background px-3 py-2.5 text-left shadow-xs ring-1 ring-border transition hover:ring-brand/50"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-muted text-brand">
          <LanguageIcon className="h-[18px] w-[18px]" />
        </span>
        <span className="flex-1 text-sm font-medium text-foreground">
          Sentence translation panel
        </span>
        <ChevronRightIcon className="h-4 w-4 text-muted-foreground" />
      </button>

      <label className="flex cursor-pointer items-center gap-3 rounded-xl bg-background px-3 py-2.5 shadow-xs ring-1 ring-border">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-muted text-brand">
          <BookOpenIcon className="h-[18px] w-[18px]" />
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block text-sm font-medium text-foreground">
            Highlight new words while reading
          </span>
          <span className="block text-[11px] text-muted-foreground">
            Underline words worth reviewing
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
