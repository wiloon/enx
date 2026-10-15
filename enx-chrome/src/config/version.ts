// The extension version comes from git tags, not from a file (ADR-031 §6a).
// A release is tagged `chrome-v<version>`; `v*` tags belong to enx-api and
// enx-ui and never touch the extension. The tag prefix exists only in git:
// Chrome's manifest takes 1-4 dot-separated integers, nothing else.
//
// Kept free of Node and Vite imports, and of TypeScript syntax Node can't
// strip, so vite.config.ts, the jest suite and plain `node` scripts can all
// import it.

export const TAG_PREFIX = 'chrome-v'

/** What a build gets when git has no `chrome-v*` tag to offer. */
export const FALLBACK_VERSION = '0.0.0'

/**
 * True for a version Chrome accepts in manifest.json: 1-4 dot-separated
 * integers, each 0-65535, with no leading zeros and no suffix like "-beta".
 */
export function isChromeVersion(version: string): boolean {
  if (!/^(0|[1-9]\d{0,4})(\.(0|[1-9]\d{0,4})){0,3}$/.test(version)) {
    return false
  }
  return version.split('.').every(part => Number(part) <= 65535)
}

/**
 * The version a release tag stands for: `chrome-v0.1.2` -> `0.1.2`.
 * Throws on a tag that has the prefix but not a version Chrome accepts, so a
 * bad tag fails the build instead of reaching the Web Store.
 */
export function versionFromTag(tag: string): string {
  if (!tag.startsWith(TAG_PREFIX)) {
    throw new Error(`"${tag}" is not an extension tag (${TAG_PREFIX}<version>)`)
  }
  const version = tag.slice(TAG_PREFIX.length)
  if (!isChromeVersion(version)) {
    throw new Error(
      `Tag "${tag}": "${version}" is not a Chrome extension version ` +
        '(1-4 dot-separated integers, each 0-65535, no leading zeros)'
    )
  }
  return version
}

/**
 * The version for a build, from the output of
 * `git describe --tags --long --match 'chrome-v*'`
 * (`chrome-v0.1.2-0-g1a2b3c4`), or null when there is no such tag.
 *
 * - On the tagged commit itself: the tag's version, `0.1.2`.
 * - N commits past it: a fourth segment counts them, `0.1.2.5`, so a dev
 *   build sorts after the release it grew from and can't be mistaken for it.
 *   A tag that already uses all four segments has no room for that and keeps
 *   its own version.
 * - No tag at all (a shallow clone, a fresh repo): `0.0.0`.
 */
export function versionFromDescribe(describe: string | null): string {
  if (!describe) return FALLBACK_VERSION
  const match = /^(.+)-(\d+)-g[0-9a-f]+$/.exec(describe.trim())
  if (!match) {
    throw new Error(`Unexpected git describe output: "${describe}"`)
  }
  const version = versionFromTag(match[1])
  const commitsSince = Number(match[2])
  if (commitsSince === 0 || version.split('.').length === 4) return version
  const devVersion = `${version}.${commitsSince}`
  if (!isChromeVersion(devVersion)) {
    throw new Error(
      `${commitsSince} commits past ${match[1]} gives "${devVersion}", ` +
        'which Chrome rejects'
    )
  }
  return devVersion
}

/**
 * True when `candidate` sorts after `latest` the way Chrome compares
 * versions: segment by segment as numbers, a missing segment counting as 0.
 */
export function isNewerVersion(candidate: string, latest: string): boolean {
  const a = candidate.split('.').map(Number)
  const b = latest.split('.').map(Number)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0)
    if (diff !== 0) return diff > 0
  }
  return false
}
