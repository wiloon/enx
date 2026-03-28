import { spawn, spawnSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const pathToExtension = path.join(__dirname, 'dist')
const url = process.argv[2] || 'https://www.infoq.com/'
const userDataDir = path.join(__dirname, '.chrome-dev-profile')
const tmpExtensionDir = '/tmp/enx-chrome-ext'
const isMac = os.platform() === 'darwin'

// Verify extension directory exists and has manifest.json
if (!fs.existsSync(pathToExtension)) {
  console.error('❌ Extension directory not found:', pathToExtension)
  console.log('💡 Run "task build" first to build the extension')
  process.exit(1)
}
if (!fs.existsSync(path.join(pathToExtension, 'manifest.json'))) {
  console.error('❌ manifest.json not found in:', pathToExtension)
  console.log('💡 Run "task build" first to build the extension')
  process.exit(1)
}

// Copy extension to /tmp to avoid sandbox restrictions on workspace paths
console.log('📋 Copying extension to /tmp for sandbox compatibility...')
fs.rmSync(tmpExtensionDir, { recursive: true, force: true })
fs.cpSync(pathToExtension, tmpExtensionDir, { recursive: true })
console.log('✅ Copied to', tmpExtensionDir)

/**
 * Find the Chromium/Chrome binary path.
 * macOS: looks for /Applications/Chromium.app
 * Linux: searches common binary names in PATH and known locations
 */
function findChromium() {
  if (isMac) {
    const macPath = '/Applications/Chromium.app/Contents/MacOS/Chromium'
    if (fs.existsSync(macPath)) return macPath
    console.error('❌ Chromium not found at /Applications/Chromium.app')
    console.log('💡 Install via: brew install --cask chromium')
    process.exit(1)
  }

  // Linux: require Chromium (not Google Chrome) for unpacked extension support.
  // Google Chrome's Linux build restricts loading unpacked extensions even with
  // --load-extension, causing the extension to silently not appear.
  const chromiumCandidates = ['chromium', 'chromium-browser']
  for (const bin of chromiumCandidates) {
    const result = spawnSync('which', [bin], { encoding: 'utf8' })
    if (result.status === 0 && result.stdout.trim()) {
      return result.stdout.trim()
    }
  }

  // Detect if Google Chrome is available, and warn the user.
  const chromeCandidates = ['google-chrome', 'google-chrome-stable']
  for (const bin of chromeCandidates) {
    const result = spawnSync('which', [bin], { encoding: 'utf8' })
    if (result.status === 0 && result.stdout.trim()) {
      console.error('❌ Chromium is required on Linux to load unpacked extensions.')
      console.error('   Google Chrome was found but it restricts --load-extension and')
      console.error('   the extension will not appear in chrome://extensions.')
      console.log('💡 Install Chromium:')
      console.log('     sudo pacman -S chromium          (Arch)')
      console.log('     sudo apt install chromium-browser  (Debian/Ubuntu)')
      process.exit(1)
    }
  }

  console.error('❌ Chromium not found. Tried:', chromiumCandidates.join(', '))
  console.log('💡 Install Chromium:')
  console.log('     sudo pacman -S chromium          (Arch)')
  console.log('     sudo apt install chromium-browser  (Debian/Ubuntu)')
  process.exit(1)
}

const chromiumBin = findChromium()

console.log('🚀 Launching Chromium with ENX extension...')
console.log('📦 Extension path:', tmpExtensionDir)
console.log('🌐 Opening URL:', url)
console.log('')

const chromeArgs = [
  `--user-data-dir=${userDataDir}`,
  `--load-extension=${tmpExtensionDir}`,
  `--disable-extensions-except=${tmpExtensionDir}`,
  '--no-default-browser-check',
  '--no-first-run',
  '--dns-over-https-mode=off',
  url,
]

let chromeProcess
if (isMac) {
  // Use 'open -a' on macOS so Chromium gets proper network entitlements
  // (required for WireGuard utun interface access)
  chromeProcess = spawn('open', [
    '-a', '/Applications/Chromium.app',
    '--wait-apps',
    '--new',
    '--args',
    ...chromeArgs,
  ], { stdio: 'inherit' })
} else {
  chromeProcess = spawn(chromiumBin, chromeArgs, { stdio: 'inherit' })
}

chromeProcess.on('exit', () => {
  console.log('👋 Browser closed')
  process.exit(0)
})

process.on('SIGINT', () => {
  console.log('\n👋 Stopping Chromium...')
  spawn('pkill', ['-f', `user-data-dir=${userDataDir}`])
  process.exit(0)
})
