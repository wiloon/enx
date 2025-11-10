import { chromium } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const pathToExtension = path.join(__dirname, 'dist')
const url = process.argv[2] || 'https://www.infoq.com/'
const userDataDir = '/tmp/chrome-dev-enx-playwright'

console.log('🚀 Starting Chromium with ENX extension...')
console.log('📦 Extension path:', pathToExtension)
console.log('🌐 Opening URL:', url)
console.log('')
console.log('✨ Extension will auto-reload when you rebuild with "task watch"')
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

const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  args: [
    `--disable-extensions-except=${pathToExtension}`,
    `--load-extension=${pathToExtension}`,
    '--disable-blink-features=AutomationControlled',
    '--exclude-switches=enable-automation',
    '--test-type', // Suppress unsupported flag warnings
    '--no-first-run',
    '--no-default-browser-check',
  ],
  viewport: null, // Allow free resizing
  ignoreDefaultArgs: ['--enable-automation'],
  devtools: false, // Don't open devtools by default
})

// Get extension ID from service worker
let [background] = context.serviceWorkers()
if (!background) {
  console.log('⏳ Waiting for service worker to load...')
  try {
    background = await context.waitForEvent('serviceworker', { timeout: 10000 })
  } catch (error) {
    console.error('❌ Service worker failed to load within 10 seconds')
    console.log('🔍 Checking if extension loaded anyway...')
    
    // Try to get extension ID from manifest
    const manifestPath = path.join(__dirname, 'dist', 'manifest.json')
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    console.log('📋 Extension name:', manifest.name)
    console.log('📋 Extension version:', manifest.version)
    console.log('')
    console.log('⚠️  Service worker not detected, but extension may still be loaded')
    console.log('💡 Check chrome://extensions/ to verify')
    
    // Continue without service worker
    background = null
  }
}

let extensionId = 'unknown'
if (background) {
  const extensionUrl = background.url()
  const parts = extensionUrl.split('/')
  extensionId = parts[2]
} else {
  console.log('⚠️  Cannot determine extension ID automatically')
}

// Configure Chrome preferences for development (after Chrome starts)
// Wait a bit for Chrome to finalize the preferences file
await new Promise(resolve => setTimeout(resolve, 1000))

if (fs.existsSync(prefsPath)) {
  let prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8'))

  // Ensure extensions settings exist
  if (!prefs.extensions) prefs.extensions = {}
  if (!prefs.extensions.settings) prefs.extensions.settings = {}
  
  // Enable developer mode
  prefs.extensions.ui = prefs.extensions.ui || {}
  prefs.extensions.ui.developer_mode = true
  console.log('🔧 Enabled developer mode')

  // Pin the extension if we have its ID
  if (extensionId !== 'unknown') {
    console.log('📌 Extension ID:', extensionId)
    
    if (!prefs.extensions.pinned_extensions) prefs.extensions.pinned_extensions = []
    
    // Pin the extension if not already pinned
    if (!prefs.extensions.pinned_extensions.includes(extensionId)) {
      prefs.extensions.pinned_extensions.push(extensionId)
      console.log('📌 Extension pinned to toolbar!')
    }

    // Make sure the extension is enabled
    if (prefs.extensions.settings[extensionId]) {
      prefs.extensions.settings[extensionId].state = 1 // 1 = enabled
    }
  }

  // Save preferences
  fs.writeFileSync(prefsPath, JSON.stringify(prefs, null, 2))
  console.log('� Saved Chrome preferences')
}

// Open chrome://extensions first to enable developer mode UI
const pages = context.pages()
const page = pages.length > 0 ? pages[0] : await context.newPage()

console.log('🔧 Opening chrome://extensions to enable developer mode...')
await page.goto('chrome://extensions/')
await new Promise(resolve => setTimeout(resolve, 2000))

console.log('🌐 Navigating to target URL...')
await page.goto(url)

console.log('')
console.log('✅ Chromium started with extension loaded!')
console.log('📝 If extension is not visible:')
console.log('   1. Go to chrome://extensions/')
console.log('   2. Enable "Developer mode" toggle (top right)')
console.log('   3. The extension should appear in the list')
console.log('   4. Pin it to toolbar if needed')
console.log('')

// Keep the process alive
process.on('SIGINT', async () => {
  console.log('\n👋 Closing Chromium...')
  await context.close()
  process.exit(0)
})
