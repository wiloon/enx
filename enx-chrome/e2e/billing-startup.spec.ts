import { test, expect } from '@playwright/test'
import { API_ORIGIN } from './auth'

// No browser or authentication substitute: Playwright starts the real API.
test('local API starts and discovers billing through the local Stripe adapter', async ({ request }) => {
  const version = await request.get(`${API_ORIGIN}/api/version`)
  expect(version.ok()).toBe(true)
  await expect.poll(async () => {
    const response = await request.get('http://127.0.0.1:12112/requests')
    const requests: { method: string; path: string }[] = await response.json()
    return requests.some(entry => entry.method === 'GET' && entry.path === '/v1/account')
  }).toBe(true)
})
