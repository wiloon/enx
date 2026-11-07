// What the popup footer says about the installed build. The version is the
// manifest's (tag-derived, ADR-031 §6a); commit and build time are stamped by
// vite.config.ts and are absent from a test or an unstamped build.

import type { TargetName } from '@/config/targets'

export interface BuildInfo {
  version: string
  environment?: string
  commit?: string
  /** ISO 8601 timestamp of the build. */
  builtAt?: string
}

export interface BuildDescription {
  /** The short footer text, e.g. `v0.1.2`. */
  label: string
  /** The hover title and the text copied for a bug report, one fact a line. */
  details: string
}

// `2026-10-13 08:05 UTC`: UTC so a report reads the same wherever it is sent.
function formatBuildTime(iso: string): string | null {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

export function describeBuild(build: BuildInfo): BuildDescription {
  const label = `v${build.version}`
  const lines = [
    build.environment
      ? `Catglish ${label} (${build.environment})`
      : `Catglish ${label}`,
  ]
  if (build.commit) lines.push(`Commit ${build.commit}`)
  const builtAt = build.builtAt && formatBuildTime(build.builtAt)
  if (builtAt) lines.push(`Built ${builtAt}`)
  return { label, details: lines.join('\n') }
}

export interface EnvironmentTag {
  /** The short tag beside the product name, e.g. `LAB`. */
  text: string
  /** The hover title, naming the build and the API it talks to. */
  title: string
}

const ENVIRONMENT_TAGS: Record<
  TargetName,
  { text: string; build: string } | null
> = {
  production: null,
  homelab: { text: 'LAB', build: 'HomeLab' },
  'homelab-test': { text: 'LAB TEST', build: 'HomeLab Test' },
  development: { text: 'DEV', build: 'Development' },
  test: { text: 'TEST', build: 'Test' },
}

/** The popup header's tag for a non-production build; `null` for production. */
export function environmentTag(
  environment: TargetName,
  apiBaseUrl: string
): EnvironmentTag | null {
  const tag = ENVIRONMENT_TAGS[environment]
  if (!tag) return null
  return { text: tag.text, title: `${tag.build} build (${apiBaseUrl})` }
}
