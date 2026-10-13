// Types for version.mjs, which vite.config.ts imports.

/** The version a build of this checkout gets. */
export function gitVersion(): string

/** The release version when HEAD is exactly on a chrome-v* tag, else null. */
export function releaseVersion(): string | null
