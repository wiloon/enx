import DebugPanel from '@/components/DebugPanel'
import Login from '@/components/Login'
import { useInitializeStorage } from '@/hooks/useInitializeStorage'
import { useWordHighlightEnabled } from '@/hooks/useWordHighlightEnabled'
import '@/index.css'
import { config } from '@/config/env'
import { initSentry } from '@/lib/sentry'
import { userAtom } from '@/store/atoms'
import { ClerkProvider, useUser } from '@clerk/chrome-extension'
import { Provider, useSetAtom } from 'jotai'
import { useEffect } from 'react'

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

function PopupContent() {
  const {
    enabled: wordHighlightEnabled,
    setEnabled: setWordHighlightEnabled,
  } = useWordHighlightEnabled()

  useInitializeStorage()

  const handleLoginSuccess = () => {
    console.log('Login successful')
  }

  // Trigger path① (spec §3.2): a click inside the popup is a real,
  // unforwarded user gesture, so sidePanel.open() here is reliable -- unlike
  // forwarding a content script's click through runtime.sendMessage (trigger
  // path③). Kept as an explicit button rather than switching
  // openPanelOnActionClick, so popup.html (and its login/logout flow) stays
  // reachable by left-clicking the toolbar icon.
  const handleOpenSentencePanel = async () => {
    try {
      const win = await chrome.windows.getCurrent()
      if (win.id !== undefined) {
        await chrome.sidePanel.open({ windowId: win.id })
      }
    } catch (error) {
      console.error('Failed to open side panel from popup:', error)
    }
  }

  return (
    <div className="min-h-[200px]">
      <ClerkUserSync />
      <Login onLoginSuccess={handleLoginSuccess} />
      <button
        type="button"
        data-testid="popup-open-sentence-panel"
        onClick={handleOpenSentencePanel}
        className="w-full mt-2 text-sm text-blue-500 hover:text-blue-600 underline"
      >
        🔤 打开整句翻译面板
      </button>
      <label className="flex items-center justify-between mt-2 px-1 text-sm cursor-pointer">
        <span className="text-gray-700">阅读时高亮生词</span>
        <input
          type="checkbox"
          data-testid="popup-word-highlight-toggle"
          checked={wordHighlightEnabled}
          onChange={e => setWordHighlightEnabled(e.target.checked)}
          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
      </label>
      {process.env.NODE_ENV === 'development' && <DebugPanel />}
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
