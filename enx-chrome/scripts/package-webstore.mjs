#!/usr/bin/env node
/**
 * Build a Chrome Web Store upload package.
 *
 *   pnpm build && node scripts/package-webstore.mjs
 *
 * Writes dist-webstore/catglish-<version>.zip.
 *
 * The one thing this does that a plain `zip -r` does not: it STRIPS the
 * top-level "key" field from the manifest.
 *
 * Why that matters. enx-chrome/manifest.json ships a fixed `key` so that an
 * unpacked local load always gets the same extension id
 * (combdcldlodkikjfhjbdbogjlfmnbjkf) -- a whole chain of config depends on
 * that id being stable: Clerk's authorized_parties, enx-ui's
 * NEXT_PUBLIC_ENX_EXTENSION_ID, the ADR-019 web-to-extension channel.
 *
 * But the Chrome Web Store REJECTS a first upload ("Add new item") whose
 * manifest contains a `key`: "key field not allowed in manifest". The store
 * mints its own key pair and derives the public id from it.
 *
 * So the flow is:
 *   1. upload this zip (no key) as a new item  -> store assigns the real id
 *   2. Package tab -> "View public key" -> copy it
 *   3. paste it into manifest.json as `key` (replacing the dev one)
 *   4. every later "Upload new package" may keep the key
 *
 * After step 3 the local unpacked id and the Web Store id are the same, which
 * is what you want -- but it also means the dev id changes, so re-check every
 * place that hardcodes it (see LAUNCH-CHECKLIST §6.1).
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, cpSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const outDir = join(root, 'dist-webstore')
const stageDir = join(outDir, 'package')

if (!existsSync(dist)) {
  console.error('dist/ not found. Run `pnpm build` first.')
  process.exit(1)
}

const manifestPath = join(dist, 'manifest.json')
if (!existsSync(manifestPath)) {
  console.error(`No manifest.json in dist/. Did the build finish?`)
  process.exit(1)
}

rmSync(outDir, { recursive: true, force: true })
mkdirSync(stageDir, { recursive: true })
cpSync(dist, stageDir, { recursive: true })

const manifest = JSON.parse(readFileSync(join(stageDir, 'manifest.json'), 'utf8'))
const hadKey = Object.prototype.hasOwnProperty.call(manifest, 'key')
delete manifest.key
writeFileSync(join(stageDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

const zipName = `catglish-${manifest.version}.zip`
// -r recurse, -q quiet, -X drop macOS extended attributes (the store rejects
// packages containing __MACOSX/ and friends).
execFileSync('zip', ['-r', '-q', '-X', join('..', zipName), '.'], { cwd: stageDir })
rmSync(stageDir, { recursive: true, force: true })

console.log(`Wrote ${join('dist-webstore', zipName)}`)
console.log(`  name:    ${manifest.name}`)
console.log(`  version: ${manifest.version}`)
console.log(`  key:     ${hadKey ? 'stripped (required for the FIRST upload)' : 'was not present'}`)

const broad = (manifest.host_permissions ?? []).filter((p) => p === 'http://*/*' || p === 'https://*/*')
if (broad.length > 0) {
  console.log('')
  console.log(`  NOTE: host_permissions requests all-URLs (${broad.join(', ')}).`)
  console.log('  That is fine for getting an id from a draft, but when you actually')
  console.log('  submit for review it triggers the broad-permissions justification')
  console.log('  path and noticeably slows approval.')
}
