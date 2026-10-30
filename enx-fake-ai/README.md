# Fake AI provider

A deterministic OpenAI-compatible HTTP service for ENX tests and HomeLab.
It has no dependencies, network client, real AI key, or upstream fallback.
Clerk sign-in still connects to the Clerk development service.

```sh
node --test enx-fake-ai/server.test.mjs
node enx-fake-ai/server.mjs
# Build from the repository root:
docker build -f enx-fake-ai/Containerfile -t enx-fake-ai enx-fake-ai
```

The service listens on `0.0.0.0:12113`; override `HOST` and `PORT` as needed.
`GET /health` reports readiness. `POST /chat/completions` recognises the
response fields in ENX's system prompts and returns a fixed sentence,
sentence with word meaning, contextual meaning, rephrase, or word definition.
These are fixtures, not accurate translations of arbitrary input. The fixed
sentence is `[fake] 这只猫在读书。`; each successful response reports 120 input
and 40 output tokens, which costs one credit at the checked-in ENX prices.
Edit `fixtures` in `server.mjs` to change the answers. Requests with unknown
prompts return 422; malformed JSON returns 400. Completion logs name the
feature without recording the input, keys, or user identity.

Configure ENX through its existing provider settings:

```sh
SENTENCE_TRANSLATE_PROVIDER=deepseek
SENTENCE_TRANSLATE_DEEPSEEK_BASE_URL=http://enx-fake-ai:12113
DEEPSEEK_API_KEY=fake
```

HomeLab uses a cluster-internal Service with no public Ingress. Local
Playwright starts the same source on loopback and sets a fixed test-only
`ACCOUNT_EMAIL_HMAC_KEY`, allowing normal sign-in to grant trial credits in
the disposable database. Do not reuse that fixed HMAC key for a persistent
deployment; keep HomeLab's existing account key and credit records.

The AI endpoint is local to the test environment. Authentication can still
use the network. These tests do not establish real-provider availability or
translation quality.
