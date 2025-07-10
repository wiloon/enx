import { useEffect } from 'react'
import { Provider } from 'jotai'
import { initSentry } from '@/lib/sentry'
import '@/index.css'

initSentry()

export default function Options() {
  useEffect(() => {
    console.log('Options page mounted')
  }, [])

  return (
    <Provider>
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-3xl font-bold text-gray-800 mb-8">
            Enx Extension Options
          </h1>
          <div className="bg-white rounded-lg shadow-lg p-6">
            <h2 className="text-xl font-semibold mb-4">Settings</h2>
            <p className="text-gray-600">
              Configure your extension settings here.
            </p>
          </div>
        </div>
      </div>
    </Provider>
  )
}