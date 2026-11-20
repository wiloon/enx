import { readdirSync, readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export function checkBundleEnv(root) {
  let javascriptFiles = 0
  const offenders = []
  function scan(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name)
      if (entry.isDirectory()) {
        scan(file)
      } else {
        const source = readFileSync(file, 'utf8')
        if (file.endsWith('.js')) javascriptFiles++
        const pattern =
          /(?:\b(VITE_[A-Za-z0-9_]+)|"(VITE_[A-Za-z0-9_]+)"|'(VITE_[A-Za-z0-9_]+)')\s*:/g
        for (const match of source.matchAll(pattern)) {
          offenders.push(
            `${file}: forbidden env object key ${match[1] ?? match[2] ?? match[3]}`
          )
        }
      }
    }
  }
  scan(root)
  if (offenders.length) {
    throw new Error(offenders.join('\n'))
  }
  if (!javascriptFiles)
    throw new Error(`${root}: no JavaScript bundles (.js) found`)
  return javascriptFiles
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = resolve(process.argv[2] ?? 'dist-production')
  try {
    console.log(`Checked ${checkBundleEnv(root)} JavaScript bundles in ${root}`)
  } catch (error) {
    console.error(`Bundle env check failed: ${error.message}`)
    process.exitCode = 1
  }
}
