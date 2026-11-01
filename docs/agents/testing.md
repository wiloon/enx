# Testing reference

The rules every change follows (red-green-refactor, prove the red, one test per behaviour, what jsdom can't see) are in [AGENTS.md](../../AGENTS.md) §Tests. This file is the reference behind them.

## Picking a test type

| What changed | Test | Why |
|---|---|---|
| Pure logic: no I/O, no DOM | Unit | Fast and isolated |
| DOM structure, rendered text, event handling | Unit (jsdom) | jsdom builds the DOM and fires events |
| Layout, positioning, overflow, scrollbars, colour, animation | Playwright | jsdom computes no layout and paints nothing: a card gray-on-gray or a scrollbar flashing passes every jsdom test. Sign-in-free component tests for this are planned in #158 |
| Domain service (enx-api) | Unit on fakes | The service takes its repositories as interfaces |
| Repository, SQL | Integration (`//go:build integration`) | Needs the real schema |
| Full HTTP request flow | Integration | Handler, service and repo together |
| Extension behaviour across content script, background and side panel | Playwright e2e | Needs the real extension context |

When a unit test is enough, start there; add Playwright when the behaviour is something only a real browser can show.

Layout logic can still be unit-tested by injecting the geometry: `enx-chrome/src/lib/__tests__/overlayPositioning.test.ts` runs Floating UI on a fake platform. That locks the decision (flip or shrink) but not what the user sees.

## Where tests live

Next to the code, in a `__tests__/` directory beside the file under test (`src/lib/__tests__/`, `src/components/__tests__/`, …). Go tests sit beside their package as `*_test.go`; integration tests carry `//go:build integration`. Playwright specs are in each sub-project's `e2e/`.

## Commands

Each sub-project's `Taskfile.yml` and `package.json` are the source of truth. The usual entry points:

| Sub-project | Unit | Other |
|---|---|---|
| enx-api | `task test` | `task test-integration`, `task test-coverage`, `task test-pkg PKG=./enx`; see `enx-api/TESTING.md` |
| enx-chrome | `pnpm test` | `pnpm build:e2e && pnpm test:e2e`; see `enx-chrome/E2E_TESTING.md` |
| enx-ui | `pnpm test` | `pnpm test:e2e` |

## E2E and Clerk sign-in

For enx-chrome server startup failures, read `test-results/servers/*.log`; filter a run with `--reporter=line`.

Signed-in e2e uses Clerk's official testing package, `@clerk/testing`, against the **development** instance (ADR-037): `clerkSetup()` gets a Testing Token that gets past bot detection, and `clerk.signIn()` signs a test user in with a sign-in ticket, skipping the email code. There is no test-only auth bypass in product code, by design (ADR-037 option A, rejected).

- Needs `CLERK_SECRET_KEY` (dev instance, `sk_test_…`; `clerkSetup` refuses a production key) and `E2E_CLERK_USER_EMAIL=e2e+clerk_test@example.com` (already created in the dev instance).
- Agents run signed-in specs themselves: load the dev key from the main checkout's `enx-ui/.env.local` into the test process only (`set -a; . <main checkout>/enx-ui/.env.local; set +a`), never print it. The maintainer approved this for the dev key on 2026-10-13.
- Without them, signed-in specs in the local lane are skipped with a stated reason, never faked. The HomeLab lane (`homelab-deployment.spec.ts`) fails instead of skipping. Specs that need no sign-in (options page, signed-out popup) run anywhere.
- enx-chrome: `pnpm build:e2e`, then `CLERK_SECRET_KEY=… E2E_CLERK_USER_EMAIL=… pnpm test:e2e`. `E2E_CHROMIUM_PATH` points at an installed Chromium when Playwright's own build is missing (it must be Chromium; branded Chrome ignores `--load-extension`).
- enx-ui: `set -a; . ./.env.local; set +a; E2E_CLERK_USER_EMAIL=… pnpm test:e2e` (the config's `webServer.env` overrides `.env.local`, so export first).

## Writing tests

- **Name the behaviour.** `flips below the word instead of shrinking when the top is a few px short`, not `test1`.
- **One scenario per `it()` / `Test*`.** Several cases of one rule: `describe`/`it` blocks in TypeScript, table-driven tests in Go.
- **Fakes at the seams.** enx-api services get in-memory repositories; for code that talks to the browser or the background, inject the boundary rather than mocking internals.
