import http from 'node:http'

// Startup reads only. Payment mutations deliberately have no implementation.
const requests = []
const prices = {
  enx_pro_monthly: 'price_e2e_pro',
  enx_pro_plus_monthly: 'price_e2e_pro_plus',
  enx_max_monthly: 'price_e2e_max',
}
const common = {
  subscription_cancel: { enabled: true, mode: 'at_period_end' },
  payment_method_update: { enabled: true },
  invoice_history: { enabled: true },
}
const planChange = {
  id: 'bpc_e2e_plan_change', object: 'billing_portal.configuration',
  active: true, is_default: true, metadata: {},
  features: {
    ...common,
    subscription_update: {
      enabled: true, proration_behavior: 'always_invoice',
      default_allowed_updates: ['price'],
      schedule_at_period_end: { conditions: [{ type: 'decreasing_item_amount' }] },
      products: Object.values(prices).map((price, i) => ({
        product: `prod_e2e_${i}`, prices: [price],
      })),
    },
  },
}
const restricted = {
  id: 'bpc_e2e_restricted', object: 'billing_portal.configuration',
  active: true, is_default: false, metadata: { enx_portal: 'restricted' },
  features: { ...common, subscription_update: { enabled: false } },
}
const list = (data, url) => ({ object: 'list', data, has_more: false, url })

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  res.setHeader('Content-Type', 'application/json')
  const send = (body, status = 200) => {
    res.writeHead(status)
    res.end(JSON.stringify(body))
  }
  if (req.method === 'GET' && url.pathname === '/health') return send({ ready: true })
  if (req.method === 'GET' && url.pathname === '/requests') return send(requests)
  requests.push({ method: req.method, path: url.pathname })
  if (req.headers.authorization !== 'Bearer sk_test_local_e2e') {
    return send({ error: { message: 'Only the local E2E key is accepted' } }, 401)
  }
  if (req.method === 'GET' && url.pathname === '/v1/account') {
    return send({ id: 'acct_local_e2e', object: 'account' })
  }
  if (req.method === 'GET' && url.pathname === '/v1/prices') {
    const key = url.searchParams.get('lookup_keys[0]')
    const id = prices[key]
    return send(list(id ? [{ id, object: 'price', lookup_key: key }] : [], url.pathname))
  }
  if (req.method === 'GET' && url.pathname === '/v1/billing_portal/configurations') {
    return send(list(url.searchParams.get('is_default') === 'true' ? [planChange] : [planChange, restricted], url.pathname))
  }
  return send({ error: { message: 'Unsupported local Stripe request; real payments are not available' } }, 501)
}).listen(12112, '127.0.0.1')
