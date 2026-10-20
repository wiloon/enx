'use client'

import { useEffect } from 'react'
import SampleArticle from '@/components/reader/SampleArticle'
import { requestReaderMode, webStoreUrl } from '@/lib/enxExtension'
import { useExtensionStatus } from '@/hooks/useExtensionStatus'

// The sample article (ADR-047 Decision 8). Outside the (app) group, so it
// needs no sign-in, and never saved, so it never expires.
export default function SampleArticlePage() {
  // The article is on the page from the first render, so ask the extension
  // to enable learning mode right away (ADR-019). No-op without it.
  useEffect(() => {
    requestReaderMode()
  }, [])
  const extensionStatus = useExtensionStatus()
  const storeUrl = webStoreUrl()

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-6">
      <p className="text-sm font-medium text-muted-foreground">
        Sample article · Click any word to look it up
      </p>
      {extensionStatus === 'not-installed' && (
        <p className="rounded-md border border-input bg-muted/40 p-3 text-sm">
          {storeUrl ? (
            <a
              href={storeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline"
            >
              Install the Catglish extension
            </a>
          ) : (
            <span className="font-medium">Install the Catglish extension</span>
          )}{' '}
          to click any word on this page for its definition.
        </p>
      )}
      <SampleArticle />
    </div>
  )
}
