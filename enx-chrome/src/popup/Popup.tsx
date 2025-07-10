import { Provider, useAtom } from 'jotai'
import { apiBaseUrlAtom } from '@/store/atoms'
import Login from '@/components/Login'
import DebugPanel from '@/components/DebugPanel'
import { initSentry } from '@/lib/sentry'
import { apiService } from '@/services/api'
import { useInitializeStorage } from '@/hooks/useInitializeStorage'
import '@/index.css'

initSentry()

function PopupContent() {
  const [apiBaseUrl] = useAtom(apiBaseUrlAtom)
  
  // Initialize state from Chrome storage
  useInitializeStorage()

  // Initialize API service with base URL
  apiService.setBaseUrl(apiBaseUrl)

  const handleLoginSuccess = () => {
    console.log('Login successful, ready to use ENX')
  }

  return (
    <div className="min-w-[350px] min-h-[200px] bg-gray-50">
      {/* Header */}
      <div className="bg-blue-500 text-white p-3 text-center">
        <h1 className="text-lg font-bold">ENX Extension</h1>
        <p className="text-sm opacity-90">English Learning Assistant</p>
      </div>

      {/* Main content */}
      <div className="p-0">
        <Login onLoginSuccess={handleLoginSuccess} />
      </div>

      {/* Footer */}
      <div className="p-3 text-center text-xs text-gray-500 border-t border-gray-200">
        <p>Click on any English word to see translation</p>
        <DebugPanel />
      </div>
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