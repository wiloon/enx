// Which auth provider a deployment runs (ADR-036 Decision 3, ADR-031).
//
// Pure and dependency-free on purpose: the server adapter (src/auth/) and the
// standalone launcher (scripts/launch.mjs, run by plain Node before
// server.js) share this one rule. Keep it to syntax Node can strip types
// from (no enums, no parameter properties) and import nothing.

export const AUTH_PROVIDERS = ['clerk'] as const
export type AuthProviderName = (typeof AUTH_PROVIDERS)[number]

// `undefined` (variable unset) selects Clerk. Any set value must be exactly a
// supported name: an empty or padded string is a mistyped deployment, not
// "unset", so it fails loudly instead of silently picking Clerk.
export function resolveAuthProvider(
  value: string | undefined
): AuthProviderName {
  if (value === undefined) return 'clerk'
  if ((AUTH_PROVIDERS as readonly string[]).includes(value)) {
    return value as AuthProviderName
  }
  throw new Error(
    `AUTH_PROVIDER must be unset or exactly "clerk"; got ${JSON.stringify(value)}`
  )
}
