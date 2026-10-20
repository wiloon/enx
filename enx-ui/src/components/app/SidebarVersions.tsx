'use client'

import { useEffect, useState } from 'react'
import { SITE } from '@/lib/site'
import { detectExtension, webStoreUrl } from '@/lib/enxExtension'
import { runtimeEnv } from '@/lib/runtimeEnv'
import { sidebarVersionLines, uiBuildVersion } from '@/lib/buildVersion'
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

// Small print at the foot of the app sidebar: the product version (enx-ui's
// own, baked into its image; enx-api's too when it runs a different build,
// see lib/buildVersion.ts) and the ENX Chrome extension's own version, read
// over the ADR-019 channel. Each line stays hidden until its check resolves,
// and on failure.
export default function SidebarVersions() {
  const [apiVersion, setApiVersion] = useState<VersionData | null>(null)
  const [extension, setExtension] = useState<ExtensionInfo | null>(null)

  useEffect(() => {
    let cancelled = false
    loadVersion().then((v) => {
      if (!cancelled) setApiVersion(v)
    })
    detectExtension().then((e) => {
      if (!cancelled) setExtension(e)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const storeUrl = webStoreUrl()
  const ui = uiBuildVersion({
    ENX_VERSION: runtimeEnv('ENX_VERSION'),
    ENX_GIT_COMMIT: runtimeEnv('ENX_GIT_COMMIT'),
    ENX_BUILD_TIME: runtimeEnv('ENX_BUILD_TIME'),
  })
  const versionLines = sidebarVersionLines(SITE.name, ui, apiVersion)

  return (
    <div className="flex flex-col gap-0.5 px-3 pt-2 text-xs text-sidebar-foreground/40">
      {versionLines.map((line) => (
        <span key={line.label} title={line.title}>
          {line.label}
        </span>
      ))}
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
