#!/usr/bin/env node
/**
 * Release the extension to production: tag origin/main as chrome-v<version>
 * and push the tag (ADR-031 §6a).
 *
 *   node scripts/release.mjs 0.1.2      # or: task release -- 0.1.2
 *
 * The push starts .github/workflows/enx-chrome-release.yml, which tests,
 * builds the production zip and attaches it to a GitHub Release. Uploading
 * the zip to the Chrome Web Store is still done by hand.
 *
 * It tags origin/main, not the local HEAD, so a local branch or unpushed
 * commit can never become a release.
 */

import { execFileSync } from 'node:child_process'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  TAG_PREFIX,
  isChromeVersion,
  isNewerVersion,
  versionFromTag,
} from '../src/config/version.ts'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
}

function fail(message) {
  console.error(message)
  process.exit(1)
}

const version = process.argv[2]
if (!version) fail('Usage: task release -- <version>, e.g. 0.1.2')
if (!isChromeVersion(version)) {
  fail(
    `"${version}" is not a Chrome extension version ` +
      '(1-4 dot-separated integers, no leading zeros, no suffix)'
  )
}

git(['fetch', '--quiet', '--tags', 'origin', 'main'])

const tag = `${TAG_PREFIX}${version}`
const latestTag = git([
  'tag',
  '--list',
  `${TAG_PREFIX}*`,
  '--sort=-v:refname',
]).split('\n')[0]
if (latestTag) {
  const latest = versionFromTag(latestTag)
  if (!isNewerVersion(version, latest)) {
    fail(
      `${version} is not higher than the latest release ${latest}; ` +
        'the Chrome Web Store rejects an upload that is not higher.'
    )
  }
}

const commit = git(['rev-parse', '--short', 'origin/main'])
const subject = git(['log', '-1', '--format=%s', 'origin/main'])
console.log(`Tagging origin/main ${commit} (${subject}) as ${tag}`)

git(['tag', '-a', tag, 'origin/main', '-m', `Catglish extension ${version}`])
try {
  git(['push', 'origin', tag])
} catch (error) {
  // Leave no local-only tag behind, or the retry would see it as the latest
  // release and refuse the same version.
  git(['tag', '-d', tag])
  throw error
}

console.log(`Pushed ${tag}. GitHub Actions now builds the zip:`)
console.log(
  '  https://github.com/wiloon/enx/actions/workflows/enx-chrome-release.yml'
)
console.log(
  `Then download it from https://github.com/wiloon/enx/releases/tag/${tag}`
)
