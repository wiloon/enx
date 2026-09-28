'use client'

import { useEffect, useState } from 'react'
import { SITE } from '@/lib/site'
import { detectExtension, webStoreUrl } from '@/lib/enxExtension'
import { apiService } from '@/services/api'
import type { VersionData } from '@/types'

type ExtensionInfo = { installed: boolean; version?: string }

// The version never changes while a page is open, and the sidebar mounts
// twice (desktop rail + mobile drawer), so fetch it once per page load.
let versionRequest: Promise<VersionData | null> | undefined

function loadVersion(): Promise<VersionData | null> {
  versionRequest ??= apiService
    .getVersion()
    .then((res) => (res.success && res.data ? res.data : null))
  return versionRequest
}

// Test hook: forget the cached request between cases.
export function resetVersionCache(): void {
  versionRequest = undefined
}

function versionTitle(v: VersionData): string {
  const parts = [`commit ${v.commit.slice(0, 7)}`]
  if (v.build_time && v.build_time !== 'unknown') {
    parts.push(`built ${v.build_time}`)
  }
  return parts.join(' · ')
}

// Small print at the foot of the app sidebar: the product version (enx-api
// and enx-ui ship from one tag, so /api/version stands for both until #51)
// and the ENX Chrome extension's own version, read over the ADR-019 channel.
// Each line stays hidden until its check resolves, and on failure.
export default function SidebarVersions() {
  const [version, setVersion] = useState<VersionData | null>(null)
  const [extension, setExtension] = useState<ExtensionInfo | null>(null)

  useEffect(() => {
    let cancelled = false
    loadVersion().then((v) => {
      if (!cancelled) setVersion(v)
    })
    detectExtension().then((e) => {
      if (!cancelled) setExtension(e)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const storeUrl = webStoreUrl()

  return (
    <div className="flex flex-col gap-0.5 px-3 pt-2 text-xs text-sidebar-foreground/40">
      {version && (
        <span title={versionTitle(version)}>
          {SITE.name} {version.version}
        </span>
      )}
      {extension?.installed && <span>Extension {extension.version ?? ''}</span>}
      {extension &&
        !extension.installed &&
        (storeUrl ? (
          <a
            href={storeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-sidebar-foreground"
          >
            Extension not installed →
          </a>
        ) : (
          <span>Extension not installed</span>
        ))}
    </div>
  )
}
