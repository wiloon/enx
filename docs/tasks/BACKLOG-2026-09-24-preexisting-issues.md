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

## 3. enx-chrome: `src/config/env.ts` cannot be loaded under Jest — DONE

Resolved on branch `chore/backlog-small-fixes`: the only `import.meta.env` read now lives in
`src/config/buildEnv.ts`, which `jest.config.js` maps to
`src/test/buildEnvStub.ts` (reads `process.env`). `env.ts` dropped its
`JEST_WORKER_ID` special case and is covered by `src/config/__tests__/env.test.ts`,
including the production-only API URL guard.

## 4. enx-ui: about 2650 ESLint errors (prettier backlog) — DONE

Resolved on branch `chore/enx-ui-lint-semi-false`: `.prettierrc` now says
`semi: false` to match the code (same as enx-chrome), the remaining ~470
formatting diffs were fixed with `eslint --fix`, the last 3 errors were fixed
by hand, `ignoreDuringBuilds` was removed from `next.config.ts`, and the
`lint` script is now `eslint .`.

## 5. enx-chrome: 12 ESLint errors — DONE

Resolved on branch `chore/backlog-small-fixes`: `no-undef` is off for TS files, the explicit `any`s are
`unknown` or typed mocks, and `prettier --write` was run over all code files
(43 had drifted, not just `preferences.ts`).

## 6. enx-ui: stale `package-lock.json` — DONE

Resolved on branch `chore/backlog-small-fixes`: deleted and added to `enx-ui/.gitignore`.

## 7. enx-chrome: build and run artifacts committed to git — DONE

`dist.crx` / `dist.pem` were removed in #35. The rest (`dev-chrome.mjs.backup`,
`dist-webstore/catglish-1.0.1.zip`, `test-results/.last-run.json`) were untracked
on branch `chore/backlog-small-fixes`, and `.gitignore` now lists `dist-webstore/`, `test-results/`,
`playwright-report/`, `blob-report/` and `*.backup`.

## 8. enx-api: two UUID libraries — DONE

Resolved on branch `chore/backlog-small-fixes`: `repo/redisx/redis_test.go` uses `google/uuid`
(`NewSHA1` = v5, same output) and `go mod tidy` dropped `satori/go.uuid`.

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

## 10. enx-chrome: root `tsc --noEmit` fails on two test files — DONE

Resolved on branch `chore/backlog-small-fixes`: `manifest.test.ts` reads the
stamped manifest through a local `StampedManifest` interface, and the statsReporter test's request mocks
are typed `(endpoint: string, options: RequestInit)`, so no tuple casts.
