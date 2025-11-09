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

const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  args: [
    `--disable-extensions-except=${pathToExtension}`,
    `--load-extension=${pathToExtension}`,
    '--disable-blink-features=AutomationControlled',
    '--exclude-switches=enable-automation',
    '--test-type', // Suppress unsupported flag warnings
  ],
  viewport: null, // Allow free resizing
  ignoreDefaultArgs: ['--enable-automation'],
})

// Get extension ID from service worker
let [background] = context.serviceWorkers()
if (!background) {
  background = await context.waitForEvent('serviceworker')
}

const extensionUrl = background.url()
const [, , extensionId] = extensionUrl.split('/')

console.log('📌 Extension ID:', extensionId)

// Pin the extension by modifying preferences
const prefsPath = path.join(userDataDir, 'Default', 'Preferences')
if (fs.existsSync(prefsPath)) {
  const prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8'))

  // Ensure extensions settings exist
  if (!prefs.extensions) prefs.extensions = {}
  if (!prefs.extensions.pinned_extensions) prefs.extensions.pinned_extensions = []

  // Pin the extension if not already pinned
  if (!prefs.extensions.pinned_extensions.includes(extensionId)) {
    prefs.extensions.pinned_extensions.push(extensionId)
    fs.writeFileSync(prefsPath, JSON.stringify(prefs, null, 2))
    console.log('📌 Extension pinned to toolbar!')
  }
}

// Use the first page (about:blank) instead of creating a new one
const pages = context.pages()
const page = pages.length > 0 ? pages[0] : await context.newPage()
await page.goto(url)

console.log('✅ Chromium started with extension loaded!')
console.log('📝 Extension is visible in chrome://extensions/ (Developer mode enabled automatically)')
console.log('')

// Keep the process alive
process.on('SIGINT', async () => {
  console.log('\n👋 Closing Chromium...')
  await context.close()
  process.exit(0)
})
