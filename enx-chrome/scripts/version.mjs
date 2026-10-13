#!/usr/bin/env node
/**
 * The extension version for the current checkout, from git tags
 * (ADR-031 §6a; the rules live in src/config/version.ts).
 *
 *   node scripts/version.mjs            # prints e.g. 0.1.2 or 0.1.2.5
 *   node scripts/version.mjs --release  # the tag's version, or exits 1 if
 *                                       # HEAD is not exactly on a chrome-v* tag
 *
 * vite.config.ts imports gitVersion() from here; the Taskfile and
 * package-webstore.mjs run it.
 */

import { execFileSync } from 'node:child_process'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  TAG_PREFIX,
  versionFromDescribe,
  versionFromTag,
} from '../src/config/version.ts'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

function git(args) {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    // No matching tag, or no git at all.
    return null
  }
}

/** The version a build of this checkout gets. */
export function gitVersion() {
  return versionFromDescribe(
    git(['describe', '--tags', '--long', '--match', `${TAG_PREFIX}*`])
  )
}

/** The release version when HEAD is exactly on a chrome-v* tag, else null. */
export function releaseVersion() {
  const tag = git([
    'describe',
    '--tags',
    '--exact-match',
    '--match',
    `${TAG_PREFIX}*`,
  ])
  return tag ? versionFromTag(tag) : null
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--release')) {
    const version = releaseVersion()
    if (!version) {
      console.error(
        `HEAD is not on a ${TAG_PREFIX}* tag. Tag the release first, e.g.\n` +
          `  git tag ${TAG_PREFIX}0.1.2 && git push origin ${TAG_PREFIX}0.1.2`
      )
      process.exit(1)
    }
    console.log(version)
  } else {
    console.log(gitVersion())
  }
}
