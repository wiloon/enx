#!/usr/bin/env node
// Test-owned HTTP stub for GET /api/dictionary/free-daily-lookup-limit.
// Started beside Next in Playwright webServer so /pricing's server fetch
// hits a real upstream (issue #1082). Browser-side page.route mocks stay
// available to the other specs.
import http from 'node:http'

const host = '127.0.0.1'
const port = Number(process.env.E2E_API_STUB_PORT || 18091)
const path = '/api/dictionary/free-daily-lookup-limit'

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url?.split('?')[0] === path) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ free_daily_lookup_limit: 1234 }))
    return
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' })
  res.end('not found')
})

server.listen(port, host, () => {
  console.log(`free-daily-lookup-limit stub on http://${host}:${port}`)
})
