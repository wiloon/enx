'use client'

import { Button } from '@/components/ui/button'
import { SITE } from '@/lib/site'
import { webStoreUrl } from '@/lib/enxExtension'
import type { ExtensionStatus } from '@/hooks/useExtensionStatus'

// The only solid button allowed on Home (ADR-027 decision 2): for someone
// without the extension, installing it is the one real primary action.
export default function ExtensionBanner({
  status,
}: {
  status: ExtensionStatus
}) {
  if (status === 'unknown') return null

  if (status === 'installed') {
    return (
      <p className="text-xs text-muted-foreground">
        {SITE.name} extension connected
      </p>
    )
  }

  const storeUrl = webStoreUrl()

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-brand/30 bg-brand/5 p-4">
      <p className="text-sm">
        Add {SITE.name} to Chrome to look up words on any English page.
      </p>
      {storeUrl && (
        <Button asChild variant="brand" size="sm">
          <a href={storeUrl} target="_blank" rel="noopener noreferrer">
            Add to Chrome
          </a>
        </Button>
      )}
    </div>
  )
}
