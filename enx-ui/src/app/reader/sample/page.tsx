'use client'

import { useEffect } from 'react'
import { SAMPLE_ARTICLE } from '@/lib/sampleArticle'
import { toParagraphs } from '@/lib/readerText'
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
      <h1 className="text-2xl font-bold">{SAMPLE_ARTICLE.title}</h1>
      <article
        id="enx-reader-article"
        className="prose max-w-none whitespace-pre-wrap text-[17px] leading-7"
      >
        {toParagraphs(SAMPLE_ARTICLE.text).map((p, i) => (
          <p key={i} className="mb-4">
            {p}
          </p>
        ))}
      </article>
    </div>
  )
}
