import type { RuntimeEnv } from './runtimeEnv'
import type { VersionData } from '@/types'

// The version enx-ui's own image was built with (#51). cnb/build.sh stamps it
// into the image's launch env and the server hands it to the browser through
// RuntimeEnvScript, so it names the UI that is actually running, even when
// enx-api was deployed from another tag. Empty on a dev server.
export function uiBuildVersion(
  env: Pick<RuntimeEnv, 'ENX_VERSION' | 'ENX_GIT_COMMIT' | 'ENX_BUILD_TIME'>
): VersionData | null {
  if (!env.ENX_VERSION) return null
  return {
    version: env.ENX_VERSION,
    commit: env.ENX_GIT_COMMIT || 'unknown',
    build_time: env.ENX_BUILD_TIME || 'unknown',
  }
}

export function versionTitle(v: VersionData): string {
  const parts = [`commit ${v.commit}`]
  if (v.build_time && v.build_time !== 'unknown') {
    parts.push(`built ${v.build_time}`)
  }
  return parts.join(' · ')
}

const known = (commit: string) => commit !== '' && commit !== 'unknown'

function sameBuild(a: VersionData, b: VersionData): boolean {
  if (a.version !== b.version) return false
  return !(known(a.commit) && known(b.commit) && a.commit !== b.commit)
}

export type VersionLine = { label: string; title: string }

// The product line shows the UI's own version. enx-api (GET /api/version) gets
// a line of its own only when it runs a different build, e.g. after
// `task deploy:homelab:api` alone. Without a baked-in UI version (dev server)
// the API's version stands for the product, as before #51.
export function sidebarVersionLines(
  product: string,
  ui: VersionData | null,
  api: VersionData | null
): VersionLine[] {
  if (!ui) {
    return api
      ? [{ label: `${product} ${api.version}`, title: versionTitle(api) }]
      : []
  }
  const lines = [{ label: `${product} ${ui.version}`, title: versionTitle(ui) }]
  if (api && !sameBuild(ui, api)) {
    lines.push({ label: `API ${api.version}`, title: versionTitle(api) })
  }
  return lines
}
