import { readdirSync, readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export function checkBundleEnv(root) {
  let javascriptFiles = 0
  function scan(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name)
      if (entry.isDirectory()) {
        scan(file)
      } else {
        const source = readFileSync(file, 'utf8')
        if (file.endsWith('.js')) javascriptFiles++
        const match = source.match(
          /(?:\b(VITE_[A-Za-z0-9_]+)|"(VITE_[A-Za-z0-9_]+)"|'(VITE_[A-Za-z0-9_]+)')\s*:/
        )
        if (match) {
          throw new Error(
            `${file}: forbidden env object key ${match[1] ?? match[2] ?? match[3]}`
          )
        }
      }
    }
  }
  scan(root)
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
