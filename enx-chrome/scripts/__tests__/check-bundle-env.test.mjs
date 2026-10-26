import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const checker = resolve('scripts/check-bundle-env.mjs')
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'enx-bundle-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}
function run(root) {
  return spawnSync(process.execPath, [checker, root], { encoding: 'utf8' })
}

test('rejects an unquoted env object key in a nested bundle', t => {
  const root = fixture(t)
  mkdirSync(join(root, 'assets'))
  writeFileSync(
    join(root, 'assets/env.js'),
    'const env = {VITE_PROBE : "leak"}'
  )
  const result = run(root)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /assets[/\\]env.js.*VITE_PROBE/)
})

for (const key of ['"VITE_PROBE"  :', "'VITE_PROBE'\n :"]) {
  test(`rejects quoted object key ${key}`, t => {
    const root = fixture(t)
    writeFileSync(join(root, 'bundle.js'), `const env = {${key} "leak"}`)
    const result = run(root)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /bundle.js.*VITE_PROBE/)
  })
}
test('rejects a missing output directory', t => {
  const result = run(join(fixture(t), 'missing'))
  assert.equal(result.status, 1)
  assert.match(result.stderr, /missing.*ENOENT|ENOENT.*missing/)
})
test('rejects output with no JavaScript bundle', t => {
  const root = fixture(t)
  writeFileSync(join(root, 'manifest.json'), '{}')
  const result = run(root)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /no JavaScript bundles/)
})
test('reports file read errors', t => {
  const root = fixture(t)
  writeFileSync(join(root, 'bundle.js'), 'const clean = true')
  symlinkSync(join(root, 'missing'), join(root, 'unreadable'))
  const result = run(root)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /ENOENT.*unreadable/)
})
test('accepts a clean JavaScript bundle', t => {
  const root = fixture(t)
  writeFileSync(
    join(root, 'bundle.js'),
    'const url = "https://api.catglish.com"'
  )
  const result = run(root)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Checked 1 JavaScript bundles/)
})

test('TypeScript rejects build env keys outside the shared allowlist', () => {
  const result = spawnSync(
    process.execPath,
    [
      'node_modules/typescript/bin/tsc',
      '--ignoreConfig',
      '--noEmit',
      '--skipLibCheck',
      '--module',
      'esnext',
      '--moduleResolution',
      'bundler',
      '--types',
      'vite/client',
      'scripts/__tests__/buildEnv.types.ts',
    ],
    { encoding: 'utf8' }
  )
  assert.equal(result.status, 0, result.stdout + result.stderr)
})
