import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const pathToExtension = path.join(__dirname, 'dist')
const url = process.argv[2] || 'https://www.infoq.com/'
const userDataDir = path.join(__dirname, '.chrome-dev-profile')
const tmpExtensionDir = '/tmp/enx-chrome-ext'

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

// Copy extension to /tmp to avoid macOS sandbox restrictions on workspace paths
console.log('📋 Copying extension to /tmp for sandbox compatibility...')
fs.rmSync(tmpExtensionDir, { recursive: true, force: true })
fs.cpSync(pathToExtension, tmpExtensionDir, { recursive: true })
console.log('✅ Copied to', tmpExtensionDir)

if (!fs.existsSync('/Applications/Chromium.app')) {
  console.error('❌ Chromium not found at /Applications/Chromium.app')
  console.log('💡 Install via: brew install --cask chromium')
  process.exit(1)
}

console.log('🚀 Launching Chromium with ENX extension...')
console.log('📦 Extension path:', tmpExtensionDir)
console.log('🌐 Opening URL:', url)
console.log('')

// Use 'open -a' to launch through macOS app infrastructure so Chromium
// gets proper network entitlements (required for WireGuard utun interface access)
const chromeProcess = spawn('open', [
  '-a', '/Applications/Chromium.app',
  '--wait-apps',
  '--new',
  '--args',
  `--user-data-dir=${userDataDir}`,
  `--load-extension=${tmpExtensionDir}`,
  `--disable-extensions-except=${tmpExtensionDir}`,
  '--no-default-browser-check',
  '--no-first-run',
  '--dns-over-https-mode=off',
  url,
], { stdio: 'inherit' })

chromeProcess.on('exit', () => {
  console.log('👋 Browser closed')
  process.exit(0)
})

process.on('SIGINT', () => {
  console.log('\n👋 Stopping Chromium...')
  spawn('pkill', ['-f', `user-data-dir=${userDataDir}`])
  process.exit(0)
})
