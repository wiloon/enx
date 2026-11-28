#!/usr/bin/env node
// Test-owned HTTP stub for signed-out server fetches on /pricing and /welcome.
// Started beside Next in Playwright webServer (issue #1082, #1238).
// Browser-side page.route mocks stay available to the other specs.
import http from 'node:http'

const host = '127.0.0.1'
const port = Number(process.env.E2E_API_STUB_PORT || 18091)

const routes = {
  '/api/dictionary/free-daily-lookup-limit': {
    free_daily_lookup_limit: 1234,
  },
  '/api/billing/trial-terms': { amount: 100, ttl_days: 30 },
}

const server = http.createServer((req, res) => {
  const pathname = req.url?.split('?')[0] ?? ''
  const body = req.method === 'GET' ? routes[pathname] : undefined
  if (body) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
    return
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' })
  res.end('not found')
})

server.listen(port, host, () => {
  console.log(`pricing/welcome API stub on http://${host}:${port}`)
})
