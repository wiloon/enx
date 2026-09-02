import DebugPanel from '@/components/DebugPanel'
import Login from '@/components/Login'
import { useInitializeStorage } from '@/hooks/useInitializeStorage'
import { useWordHighlightEnabled } from '@/hooks/useWordHighlightEnabled'
import '@/index.css'
import { initSentry } from '@/lib/sentry'
import { sendMessageToBackground } from '@/services/api'
import { sessionAtom, userAtom } from '@/store/atoms'
import { Provider, useAtom } from 'jotai'
import { useEffect } from 'react'
import type { ApiRequestResult } from '@/background/background'

initSentry()

function PopupContent() {
  const [user, setUser] = useAtom(userAtom)
  const [session, setSession] = useAtom(sessionAtom)
  const {
    enabled: wordHighlightEnabled,
    setEnabled: setWordHighlightEnabled,
  } = useWordHighlightEnabled()

  useInitializeStorage()

  useEffect(() => {
    const validate = async () => {
      if (!user.isLoggedIn || !session.accessToken) return
      // Goes through background's makeApiRequest, which silently refreshes an
      // expired access token and retries once before reporting failure — see
      // docs/tasks/TASK-SPEC-enx-cognito-session-refresh.md §3.5.
      const response = await sendMessageToBackground<ApiRequestResult>({
        type: 'validateSession',
      })
      if (!response.success) {
        setUser({ id: 0, username: '', email: '', isLoggedIn: false })
        setSession({ accessToken: '', refreshToken: '' })
        await chrome.storage.local.remove([
          'user',
          'enx-user',
          'accessToken',
          'refreshToken',
          'enx-session',
        ])
      }
    }
    validate()
  }, [user.isLoggedIn, session.accessToken, setUser, setSession])

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
    <Provider>
      <PopupContent />
    </Provider>
  )
}
