import {
  config,
  getApiBaseUrl,
  resetApiBaseUrl,
  setApiBaseUrl,
} from '@/config/env'
import '@/index.css'
import { initSentry } from '@/lib/sentry'
import { useWordHighlightEnabled } from '@/hooks/useWordHighlightEnabled'
import { apiBaseUrlAtom } from '@/store/atoms'
import { Provider, useAtom } from 'jotai'
import { useEffect, useState } from 'react'

initSentry()

function OptionsContent() {
  const [apiBaseUrl, setApiBaseUrlAtom] = useAtom(apiBaseUrlAtom)
  const [customUrl, setCustomUrl] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [message, setMessage] = useState('')
  const {
    enabled: wordHighlightEnabled,
    setEnabled: setWordHighlightEnabled,
  } = useWordHighlightEnabled()

  useEffect(() => {
    // Load the current API URL on mount
    const loadApiUrl = async () => {
      try {
        const url = await getApiBaseUrl()
        setApiBaseUrlAtom(url)
        setCustomUrl(url)
      } catch (error) {
        console.error('Failed to load API URL:', error)
      } finally {
        setIsLoading(false)
      }
    }
    loadApiUrl()
  }, [setApiBaseUrlAtom])

  const handleSave = async () => {
    try {
      await setApiBaseUrl(customUrl)
      setApiBaseUrlAtom(customUrl)
      setMessage('✅ API URL saved successfully!')
      setTimeout(() => setMessage(''), 3000)
    } catch (error) {
      setMessage('❌ Failed to save API URL')
      console.error('Failed to save API URL:', error)
    }
  }

  const handleReset = async () => {
    try {
      await resetApiBaseUrl()
      setApiBaseUrlAtom(config.apiBaseUrl)
      setCustomUrl(config.apiBaseUrl)
      setMessage(`✅ Reset to default: ${config.apiBaseUrl}`)
      setTimeout(() => setMessage(''), 3000)
    } catch (error) {
      setMessage('❌ Failed to reset API URL')
      console.error('Failed to reset API URL:', error)
    }
  }

  const presetUrls = [
    { label: 'Local (Development)', url: 'http://localhost:8090' },
    { label: 'Lab', url: 'https://enx-api.wiloon.lab' },
    { label: 'Production', url: 'https://enx-api.wiloon.com' },
  ]

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 p-8 flex items-center justify-center">
        <div className="text-gray-600">Loading...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-800 mb-8">
          Enx Extension Options
        </h1>

        {/* Current Environment Info */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <h3 className="text-sm font-semibold text-blue-800 mb-2">
            Current Environment
          </h3>
          <p className="text-sm text-blue-700">
            <span className="font-medium">Mode:</span> {config.environment}
          </p>
          <p className="text-sm text-blue-700">
            <span className="font-medium">Default API:</span>{' '}
            {config.apiBaseUrl}
          </p>
          <p className="text-sm text-blue-700">
            <span className="font-medium">Active API:</span> {apiBaseUrl}
          </p>
        </div>

        {/* API URL Configuration */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4 text-gray-800">
            API URL Configuration
          </h2>

          {/* Preset URLs */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Quick Select:
            </label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {presetUrls.map(preset => (
                <button
                  key={preset.url}
                  onClick={() => setCustomUrl(preset.url)}
                  className={`p-3 rounded-lg border-2 transition-all ${
                    customUrl === preset.url
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 bg-white text-gray-700 hover:border-blue-300'
                  }`}
                >
                  <div className="font-medium text-sm">{preset.label}</div>
                  <div className="text-xs mt-1 opacity-75">{preset.url}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Custom URL Input */}
          <div className="mb-4">
            <label
              htmlFor="apiUrl"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              Custom API URL:
            </label>
            <input
              type="text"
              id="apiUrl"
              value={customUrl}
              onChange={e => setCustomUrl(e.target.value)}
              placeholder="http://localhost:8090"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <p className="mt-2 text-sm text-gray-500">
              Enter the base URL of your ENX API server (e.g.,
              http://localhost:8090)
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3">
            <button
              onClick={handleSave}
              className="px-6 py-2 bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-lg transition-colors"
            >
              Save
            </button>
            <button
              onClick={handleReset}
              className="px-6 py-2 bg-gray-500 hover:bg-gray-600 text-white font-medium rounded-lg transition-colors"
            >
              Reset to Default
            </button>
          </div>

          {/* Status Message */}
          {message && (
            <div
              className={`mt-4 p-3 rounded-lg ${
                message.startsWith('✅')
                  ? 'bg-green-50 text-green-700'
                  : 'bg-red-50 text-red-700'
              }`}
            >
              {message}
            </div>
          )}
        </div>

        {/* Reading Preferences */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4 text-gray-800">
            Reading Preferences
          </h2>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              data-testid="word-highlight-toggle"
              checked={wordHighlightEnabled}
              onChange={e => setWordHighlightEnabled(e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span>
              <span className="block text-sm font-medium text-gray-800">
                Highlight vocabulary while reading
              </span>
              <span className="block text-sm text-gray-500">
                Underlines words worth reviewing. Turn off for a clean page —
                you can still click any word to look it up.
              </span>
            </span>
          </label>
        </div>

        {/* Help Section */}
        <div className="bg-white rounded-lg shadow-lg p-6">
          <h2 className="text-xl font-semibold mb-4 text-gray-800">Help</h2>
          <div className="space-y-3 text-sm text-gray-600">
            <p>
              <strong className="text-gray-800">Development (Local):</strong>{' '}
              Use http://localhost:8090 when running the API server locally for
              development.
            </p>
            <p>
              <strong className="text-gray-800">Lab:</strong> Use
              https://enx-api.wiloon.lab for the homelab lab deployment.
            </p>
            <p>
              <strong className="text-gray-800">Production:</strong> Use
              https://enx-api.wiloon.com for the live production environment.
            </p>
            <p className="text-gray-500 text-xs mt-4">
              💡 Tip: After changing the API URL, you may need to log in again.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Options() {
  return (
    <Provider>
      <OptionsContent />
    </Provider>
  )
}
