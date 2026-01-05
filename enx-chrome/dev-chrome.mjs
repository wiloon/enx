import { exec } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const pathToExtension = path.join(__dirname, 'dist')
const url = process.argv[2] || 'https://www.infoq.com/'
const userDataDir = path.join(__dirname, '.chrome-dev-profile')

console.log('🚀 Starting Chrome with ENX extension...')
console.log('📦 Extension path:', pathToExtension)
console.log('🌐 Opening URL:', url)
console.log('💾 User data:', userDataDir)
console.log('')
console.log('✨ ENX extension will be auto-loaded')
console.log('✨ You can also install other extensions from Chrome Web Store')
console.log('🔧 Press Ctrl+C to stop')
console.log('')

// Pre-configure Chrome preferences to enable developer mode
const defaultDir = path.join(userDataDir, 'Default')
const prefsPath = path.join(defaultDir, 'Preferences')

if (!fs.existsSync(defaultDir)) {
  fs.mkdirSync(defaultDir, { recursive: true })
}

// Create or update preferences to enable developer mode
let prefs = {}
if (fs.existsSync(prefsPath)) {
  prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8'))
}

// Enable developer mode
if (!prefs.extensions) prefs.extensions = {}
prefs.extensions.ui = prefs.extensions.ui || {}
prefs.extensions.ui.developer_mode = true

fs.writeFileSync(prefsPath, JSON.stringify(prefs, null, 2))
console.log('🔧 Pre-configured developer mode')
console.log('')

// Try different Chrome executable paths
const chromePaths = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
]

let chromePath = chromePaths.find(p => fs.existsSync(p))

if (!chromePath) {
  console.error('❌ Chrome/Chromium not found in common locations')
  console.log('Searched:', chromePaths.join(', '))
  process.exit(1)
}

console.log('✅ Found Chrome:', chromePath)
console.log('📦 Extension will load from:', pathToExtension)
console.log('')

// Verify extension directory exists and has manifest.json
if (!fs.existsSync(pathToExtension)) {
  console.error('❌ Extension directory not found:', pathToExtension)
  process.exit(1)
}

const manifestPath = path.join(pathToExtension, 'manifest.json')
if (!fs.existsSync(manifestPath)) {
  console.error('❌ manifest.json not found in:', pathToExtension)
  console.log('💡 Run "task build" first to build the extension')
  process.exit(1)
}

console.log('✅ Extension manifest found')
console.log('')

// Launch Chrome with native command
const chromeArgs = [
  `--user-data-dir=${userDataDir}`,
  '--no-default-browser-check',
  '--no-first-run',
  url
].join(' ')

const chromeCmd = `${chromePath} ${chromeArgs}`

console.log('🚀 Launching Chrome...')
console.log('')
console.log('📝 First time setup (one-time only):')
console.log('   1. Visit chrome://extensions/')
console.log('   2. Confirm "Developer mode" is ON (top right)')
console.log('   3. Click "Load unpacked"')
console.log('   4. Select: ' + pathToExtension)
console.log('')
console.log('✨ After setup, extension will be remembered and auto-load')
console.log('✨ You can also install other extensions from Chrome Web Store')
console.log('')

const chromeProcess = exec(chromeCmd, (error, stdout, stderr) => {
  if (error && error.code !== null) {
    console.error('❌ Chrome exited with error:', error)
  }
})

// Handle cleanup
process.on('SIGINT', () => {
  console.log('\n👋 Stopping Chrome...')
  chromeProcess.kill()
  process.exit(0)
})

// Keep process alive
process.stdin.resume()
