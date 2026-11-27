// A built extension must carry its localised store listing (ADR-096 Decision
// 10). build:prod runs this on dist-production/, which package-prod.mjs zips
// whole for the Chrome Web Store.
import { readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const LOCALES = ['en', 'zh_CN']
const MESSAGE_KEYS = ['extName', 'extDescription']

export function checkLocales(root) {
  const read = file => JSON.parse(readFileSync(join(root, file), 'utf8'))
  const problems = []

  for (const locale of LOCALES) {
    const file = `_locales/${locale}/messages.json`
    const messages = read(file)
    for (const key of MESSAGE_KEYS) {
      if (!messages[key]?.message) problems.push(`${file}: no ${key} message`)
    }
  }

  const manifest = read('manifest.json')
  if (manifest.default_locale !== 'en') {
    problems.push('manifest.json: default_locale is not "en"')
  }
  // A build suffix may follow the name placeholder.
  if (!manifest.name?.startsWith('__MSG_extName__')) {
    problems.push('manifest.json: name does not use __MSG_extName__')
  }
  if (manifest.description !== '__MSG_extDescription__') {
    problems.push(
      'manifest.json: description does not use __MSG_extDescription__'
    )
  }

  if (problems.length) throw new Error(problems.join('\n'))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = resolve(process.argv[2] ?? 'dist-production')
  try {
    checkLocales(root)
    console.log(`Checked the localised name and description in ${root}`)
  } catch (error) {
    console.error(`Locale check failed: ${error.message}`)
    process.exitCode = 1
  }
}
