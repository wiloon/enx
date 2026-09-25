# Backlog: pre-existing issues found during the 2026-09-24 dependency upgrade

These issues were already on `main` before the dependency upgrade
(branch `claude/inspiring-pasteur-43w5o7`). They were left alone so the upgrade
diff stays reviewable. Each one was checked against `main` to confirm the
upgrade did not cause it.

The committed `enx-chrome/dist.pem` private key is **not** tracked here. It is
being handled on a separate branch.

## 1. enx-api: integration test fails when the package runs as a whole — DONE

Resolved on branch `fix/enx-api-integration-test-db`. The original guess (a
shared SQLite file) was wrong. The real cause: `ecp_integration_test.go`
opened its DB once in `init()`, but other tests in `enx/` (`ecp_crud_test.go`
and others) replace the global `sqlitex.DB` with in-memory DBs migrated from
`repo.Word`, whose `english` column had no `unique` constraint. So when the
integration test ran after them, `Save()` twice inserted two rows.

Fixes: the integration tests now call `sqlitex.Init()` per test on a
`t.TempDir()` DB; `repo.Word.English` now has `unique;not null` to match
`sqlitex.Word`; `Word.Save()` now returns the insert error and no longer sets
`word.Id` when nothing was persisted. `fillFromEcdict` falls back to the
existing row when a concurrent lookup inserted the word first.

## 2. enx-chrome: Playwright E2E is flaky, and most specs need a real login

- In a sandbox without Clerk or homelab access, most specs fail on `main` and
  on the upgrade branch alike (content highlighting, translation popup, word
  highlight toggle). They need a signed-in session and reachable API/Clerk
  endpoints.
- Order dependence: `e2e/options-page.spec.ts:5` passes alone but failed in a
  full-suite run on `main`. Some state likely leaks between tests, such as
  `chrome.storage` or the reused API server (`reuseExistingServer`).
- `e2e/fixtures.ts` always loads `dist-homelab`, so the extension under test
  points at the homelab API, not the local `enx-api` that `playwright.config.ts`
  starts on :8090.
- Suggested follow-up: document the E2E prerequisites. Consider a local build
  mode aimed at the :8090 API, and isolate storage per test.

## 3. enx-chrome: `src/config/env.ts` cannot be loaded under Jest

- `env.ts` uses `import.meta.env`. The current ts-jest (CommonJS) setup fails
  with "Must use import to load ES Module", so every test that touches it
  mocks `@/config/env`.
- Impact: `getApiBaseUrl` / `setApiBaseUrl` / `resetApiBaseUrl` and the
  production-only "no API URL override" guard (`apiBaseUrlOverrideAllowed`)
  have no unit tests. That guard exists to stop token exfiltration.
- Suggested fix: move the `import.meta.env` reads behind a tiny module that
  tests can mock (e.g. `config/buildEnv.ts`), or switch the Jest transform to
  ESM or babel with an `import.meta` plugin. Then add tests for the three
  functions and for the production guard.

## 4. enx-ui: about 2650 ESLint errors (prettier backlog) — DONE

Resolved on branch `chore/enx-ui-lint-semi-false`: `.prettierrc` now says
`semi: false` to match the code (same as enx-chrome), the remaining ~470
formatting diffs were fixed with `eslint --fix`, the last 3 errors were fixed
by hand, `ignoreDuringBuilds` was removed from `next.config.ts`, and the
`lint` script is now `eslint .`.

## 5. enx-chrome: 12 ESLint errors

- `npx eslint .` reports 12 errors: several `@typescript-eslint/no-explicit-any`
  (in `background.ts`, `statsReporter.ts`, `types/index.ts`, `test/setup.ts`,
  and tests), plus 5 `no-undef` for `RequestInit`.
- `RequestInit` is a TypeScript DOM type, and `no-undef` should be off for TS
  files (typescript-eslint recommends this). Add `'no-undef': 'off'` to the TS
  block of `eslint.config.mjs`.
- `src/config/preferences.ts` is also not prettier-formatted
  (`prettier --check` fails on it).

## 6. enx-ui: stale `package-lock.json`

- `enx-ui` has both `pnpm-lock.yaml`, which the Containerfile and CI use, and a
  `package-lock.json` that was last touched in commit `0004c05` ("deepseek").
  The npm lockfile is not used and has drifted. Delete it (and consider adding
  `package-lock.json` to `.gitignore` for this folder).

## 7. enx-chrome: build and run artifacts committed to git

Tracked files that should not be in version control:

- `enx-chrome/dist.crx`: packed extension (build output)
- `enx-chrome/dist-webstore/catglish-1.0.1.zip`: Web Store package (build output)
- `enx-chrome/dev-chrome.mjs.backup`: backup file
- `enx-chrome/test-results/.last-run.json`: Playwright run state, rewritten on every E2E run

Suggested fix: `git rm --cached` them and add `dist.crx`, `dist-webstore/`,
`*.backup`, and `test-results/` to `enx-chrome/.gitignore`. Coordinate with
the `dist.pem` cleanup branch, which may already cover `dist.crx`.

## 8. enx-api: two UUID libraries

- `github.com/satori/go.uuid` v1.2.0 is unmaintained and affected by
  CVE-2021-3538 (insecure randomness). It is a direct dependency next to
  `github.com/google/uuid`.
- Its only user is a test: `repo/redisx/redis_test.go`. Production code does
  not use it, so the risk is low.
- Suggested fix: switch that test to `google/uuid` and run `go mod tidy` to
  drop the module.

## 9. Upgrades deliberately deferred (breaking majors)

Not bugs, just left for dedicated changes:

| Project    | Package                                   | Current   | Latest |
|------------|-------------------------------------------|-----------|--------|
| enx-ui     | next / eslint-config-next                 | 15.5.26   | 16.x (middleware -> proxy rename, `next lint` removed, `eslint` config key removed) |
| enx-ui     | @sentry/nextjs                            | 9.47      | 11.x   |
| enx-ui, enx-chrome | eslint (9.x is now marked deprecated on npm) | 9.39 | 10.x |
| enx-ui, enx-chrome | typescript                        | 5.9       | 7.x    |
| enx-ui, enx-chrome | jotai                             | 2.20      | 3.x    |
| enx-ui, enx-chrome | @testing-library/jest-dom         | 6.9       | 7.x    |
| enx-chrome | vite / @crxjs/vite-plugin / @vitejs/plugin-react | 7 / 2.7 / 5 | 8 / 3 / 6 (must move together) |
| enx-chrome | @sentry/react                             | 10.x      | 11.x   |

## 10. enx-chrome: root `tsc --noEmit` fails on two test files

- `pnpm exec tsc --noEmit` (root `tsconfig.json`, which includes tests)
  reports TS18046/TS18048/TS2488 in `src/__tests__/manifest.test.ts`:
  `manifest.externally_connectable` is `unknown` and `manifest.content_scripts`
  is possibly `undefined`. `src/background/__tests__/statsReporter.test.ts`
  has 3 more (TS2352/TS2493: casting `fetch` mock call tuples). All 10 errors
  are on `main` as well.
- `pnpm build` only type-checks `tsconfig.app.json`, and Jest still passes, so
  nothing caught it. Probably a manifest type change from the 2026-09-24
  dependency upgrade (#34). Found while moving to pnpm 12; the lockfile is
  unchanged, so pnpm is not the cause.
- Suggested fix: narrow the types in the test (a type guard or a local
  interface for the fields it reads).
