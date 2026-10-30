import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'

test('Chat Completions returns a stable sentence translation and billable usage', async t => {
  const server = spawn(process.execPath, ['server.mjs'], {
    cwd: import.meta.dirname, env: { ...process.env, PORT: '0', HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  t.after(() => server.kill())
  const address = await Promise.race([
    once(server.stdout, 'data').then(([data]) => JSON.parse(data).port),
    once(server, 'exit').then(() => { throw new Error('Server exited before readiness') }),
  ])
  const response = await fetch(`http://127.0.0.1:${address}/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'deepseek-flash', messages: [
      { role: 'system', content: 'You are a professional English-to-Chinese translator. Translate the given English sentence into natural, fluent Chinese.' },
      { role: 'user', content: 'The cat reads a book.' },
    ] }),
  })
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.equal(result.choices[0].message.content, '[fake] 这只猫在读书。')
  assert.deepEqual(result.usage, { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160 })
})

test('rephrase returns structured idiomatic wording rather than a translation', async t => {
  const server = spawn(process.execPath, ['server.mjs'], {
    cwd: import.meta.dirname, env: { ...process.env, PORT: '0', HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  t.after(() => server.kill())
  const [data] = await once(server.stdout, 'data')
  const response = await fetch(`http://127.0.0.1:${JSON.parse(data).port}/chat/completions`, {
    method: 'POST', body: JSON.stringify({ messages: [
      { role: 'system', content: 'Return ONLY a JSON object: {"idiomatic": "...", "alternatives": []}' },
      { role: 'user', content: 'Please review this.' },
    ] }),
  })
  const result = await response.json()
  assert.deepEqual(JSON.parse(result.choices[0].message.content), {
    idiomatic: '[fake] Could you review this?',
    alternatives: [{ text: 'Please take a look.', register: 'casual' }], notes: [],
  })
})

for (const scenario of [
  { name: 'sentence with word', prompt: '{"sentence": "translation", "word": "meaning"}', answer: { sentence: '[fake] 这只猫在读书。', word: '猫' } },
  { name: 'word context', prompt: '{"word": "meaning", "why": "explanation"}', answer: { word: '猫', why: '' } },
  { name: 'word definition', prompt: '{"is_word": true, "quality": 9, "senses": []}', answer: { is_word: true, quality: 9, senses: [{ pos: 'n.', zh: '很有魅力的人' }] } },
]) {
  test(`${scenario.name} returns its own structured fixture`, async t => {
    const server = spawn(process.execPath, ['server.mjs'], {
      cwd: import.meta.dirname, env: { ...process.env, PORT: '0', HOST: '127.0.0.1' },
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    t.after(() => server.kill())
    const [data] = await once(server.stdout, 'data')
    const response = await fetch(`http://127.0.0.1:${JSON.parse(data).port}/chat/completions`, {
      method: 'POST', body: JSON.stringify({ messages: [
        { role: 'system', content: scenario.prompt }, { role: 'user', content: 'Word: rizz' },
      ] }),
    })
    assert.equal(response.status, 200)
    const result = await response.json()
    assert.deepEqual(JSON.parse(result.choices[0].message.content), scenario.answer)
  })
}

test('health is ready and unsupported or malformed requests fail without stopping the server', async t => {
  const server = spawn(process.execPath, ['server.mjs'], {
    cwd: import.meta.dirname, env: { ...process.env, PORT: '0', HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  t.after(() => server.kill())
  const [data] = await once(server.stdout, 'data')
  const origin = `http://127.0.0.1:${JSON.parse(data).port}`
  assert.equal((await fetch(`${origin}/health`)).status, 200)
  assert.equal((await fetch(`${origin}/chat/completions`, { method: 'POST', body: '{broken' })).status, 400)
  assert.equal((await fetch(`${origin}/chat/completions`, { method: 'POST', body: JSON.stringify({ messages: [{ role: 'system', content: 'Unknown feature' }] }) })).status, 422)
  assert.equal((await fetch(`${origin}/unknown`)).status, 404)
  assert.equal((await fetch(`${origin}/health`)).status, 200)
})
