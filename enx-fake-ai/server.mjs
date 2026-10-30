import http from 'node:http'

// Match the response contracts requested by enx-api's shared prompt builders.
// There is deliberately no network client or real-provider fallback here.
const fixtures = [
  ['rephrase', '"idiomatic"', { idiomatic: '[fake] Could you review this?', alternatives: [{ text: 'Please take a look.', register: 'casual' }], notes: [] }],
  ['sentence-word', '"sentence"', { sentence: '[fake] 这只猫在读书。', word: '猫' }],
  ['word-context', '"why"', { word: '猫', why: '' }],
  ['word-definition', '"is_word"', { is_word: true, quality: 9, senses: [{ pos: 'n.', zh: '很有魅力的人' }] }],
  ['sentence', 'English-to-Chinese translator', '[fake] 这只猫在读书。'],
]

const server = http.createServer(async (req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
  }
  if (req.method === 'GET' && req.url === '/health') return send(200, { ready: true })
  if (req.method !== 'POST' || req.url !== '/chat/completions') {
    return send(404, { error: { message: 'Unsupported fake AI endpoint' } })
  }
  let request
  try {
    let body = ''
    for await (const chunk of req) {
      body += chunk
      if (Buffer.byteLength(body) > 65536) return send(413, { error: { message: 'Request too large' } })
    }
    request = JSON.parse(body)
    if (!Array.isArray(request?.messages) || request.messages.some(message => typeof message?.content !== 'string')) {
      throw new Error('Invalid messages')
    }
  } catch {
    return send(400, { error: { message: 'Expected Chat Completions JSON messages' } })
  }
  const prompt = request.messages.find(message => message.role === 'system')?.content ?? ''
  const fixture = fixtures.find(([, marker]) => prompt.includes(marker))
  if (!fixture) return send(422, { error: { message: 'Unsupported fake AI prompt' } })
  const [feature, , answer] = fixture
  console.log(JSON.stringify({ event: 'completion', feature }))
  return send(200, {
    id: 'chatcmpl-fake', object: 'chat.completion', model: request.model ?? 'fake',
    choices: [{ index: 0, message: { role: 'assistant', content: typeof answer === 'string' ? answer : JSON.stringify(answer) }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160 },
  })
})
server.listen(Number(process.env.PORT ?? 12113), process.env.HOST ?? '0.0.0.0', () => {
  console.log(JSON.stringify({ event: 'listening', port: server.address().port }))
})
