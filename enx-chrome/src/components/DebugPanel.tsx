import { useAtom } from 'jotai'
import { userAtom, sessionAtom } from '@/store/atoms'

export default function DebugPanel() {
  const [user] = useAtom(userAtom)
  const [session] = useAtom(sessionAtom)

  if (process.env.NODE_ENV !== 'development') {
    return null
  }

  return (
    <div className="mt-4 p-3 bg-gray-100 rounded text-xs">
      <h4 className="font-bold mb-2">Debug Info:</h4>
      <div className="space-y-1">
        <div>User: {JSON.stringify(user, null, 2)}</div>
        <div>Session: {JSON.stringify(session, null, 2)}</div>
        <button
          onClick={async () => {
            const result = await chrome.storage.local.get([
              'enx-user',
              'enx-session',
              'user',
              'sessionId',
            ])
            console.log('Chrome Storage:', result)
            alert('Check console for storage data')
          }}
          className="mt-2 px-2 py-1 bg-blue-500 text-white rounded text-xs"
        >
          Check Storage
        </button>
      </div>
    </div>
  )
}
