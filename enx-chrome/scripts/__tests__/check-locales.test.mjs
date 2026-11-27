import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { checkLocales } from '../check-locales.mjs'

const MESSAGES = {
  extName: { message: 'Catglish' },
  extDescription: { message: 'Read English in English' },
}
const MANIFEST = {
  default_locale: 'en',
  name: '__MSG_extName__',
  description: '__MSG_extDescription__',
}

// A built dist directory; `files` overrides a file's JSON, or drops it with
// null.
function dist(t, files = {}) {
  const root = mkdtempSync(join(tmpdir(), 'enx-locales-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const all = {
    'manifest.json': MANIFEST,
    '_locales/en/messages.json': MESSAGES,
    '_locales/zh_CN/messages.json': MESSAGES,
    ...files,
  }
  for (const [file, content] of Object.entries(all)) {
    if (content === null) continue
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), JSON.stringify(content))
  }
  return root
}

test('accepts a localised build', t => {
  assert.doesNotThrow(() => checkLocales(dist(t)))
})

test('accepts a build whose name carries a suffix after the placeholder', t => {
  const manifest = { ...MANIFEST, name: '__MSG_extName__ (Lab)' }
  assert.doesNotThrow(() =>
    checkLocales(dist(t, { 'manifest.json': manifest }))
  )
})

for (const locale of ['en', 'zh_CN']) {
  const file = `_locales/${locale}/messages.json`

  test(`rejects a build without ${file}`, t => {
    assert.throws(
      () => checkLocales(dist(t, { [file]: null })),
      new RegExp(locale)
    )
  })

  for (const key of ['extName', 'extDescription']) {
    test(`rejects ${locale} without ${key}`, t => {
      const messages = { ...MESSAGES, [key]: undefined }
      assert.throws(
        () => checkLocales(dist(t, { [file]: messages })),
        new RegExp(`${locale}.*${key}`)
      )
    })
  }
}

for (const [key, value] of [
  ['default_locale', undefined],
  ['name', 'Catglish'],
  ['description', 'Read English in English'],
]) {
  test(`rejects a manifest whose ${key} is not localised`, t => {
    const manifest = { ...MANIFEST, [key]: value }
    assert.throws(
      () => checkLocales(dist(t, { 'manifest.json': manifest })),
      new RegExp(`manifest.json.*${key}`)
    )
  })
}

test('fails the command that build:prod runs on a bad build', t => {
  const result = spawnSync(
    process.execPath,
    [
      resolve('scripts/check-locales.mjs'),
      dist(t, { '_locales/zh_CN/messages.json': null }),
    ],
    { encoding: 'utf8' }
  )
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Locale check failed.*zh_CN/)
})
