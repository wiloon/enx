// Mirrors reader.MaxContentLength (ADR-022 Option C) -- server-enforced,
// this is just so the textarea and counter match what the backend will
// accept.
export const MAX_CONTENT_LENGTH = 20000

// "Try a sample" on the empty Reader: the kind of text Reader is for -- an AI
// assistant's reply -- with a few words worth looking up. Written for Catglish.
export const SAMPLE_TEXT = `Short answer: the version string looked odd because the homelab pipeline stamps the full commit hash into every build, whereas production builds use the release tag.

This isn't a bug so much as an inconsistency between two environments. The fix is deliberately conservative: truncate the hash to seven characters and prefix it with "dev-", so nobody mistakes a homelab build for a tagged release. The complete hash remains available on hover, which preserves the information without cluttering the sidebar.

Neither change affects production. If you'd rather surface how far a build has drifted from the last release, we could adopt git describe instead, at the cost of fetching tags during the clone.`
