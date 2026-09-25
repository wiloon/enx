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

## 9. Upgrades deliberately deferred (breaking majors) — PARTLY DONE

Done on 2026-09-25, each in its own PR with the breaking changes fixed in code:

| PR  | Project    | Upgrade |
|-----|------------|---------|
| #39 | enx-ui     | next / eslint-config-next 15.5 -> 16.3, @sentry/nextjs 9 -> 11 (Sentry 9 does not accept next 16 as a peer) |
| #40 | enx-chrome | vite 7 -> 8, @crxjs/vite-plugin 2.7 -> 3, @vitejs/plugin-react 5 -> 6, @sentry/react 10 -> 11 |
| #41 | both       | jotai 2 -> 3, @testing-library/jest-dom 6 -> 7 |

### Still open: blocked upstream

Neither affects what users run: both are build/dev-time tools and are not in
the shipped extension or the enx-ui image.

| Project | Package | Current | Target | Blocked by | Retry when |
|---------|---------|---------|--------|------------|------------|
| enx-ui, enx-chrome | eslint | 9.39 | 10.x | Latest `eslint-plugin-react` (7.37.5), `eslint-plugin-import` (2.32.0) and `eslint-plugin-jsx-a11y` (6.10.2) all declare `eslint` peers up to `^9` only. enx-chrome uses eslint-plugin-react directly; eslint-config-next pulls in all three. | All three publish an eslint 10 peer range (`pnpm view <pkg> peerDependencies.eslint`) |
| enx-ui, enx-chrome | typescript | 5.9 | 7.x | TS 7 is the Go rewrite with no stable JS API yet (only `typescript/unstable/*`). `ts-jest` peers `typescript <7`, `typescript-eslint` peers `<6.1.0`, and Next's build type-check uses the JS API. | ts-jest and typescript-eslint support 7; TS 6.0 is possible earlier as a stepping stone (both already accept it) |

eslint 9 shows as "deprecated" on npm because 10 is out, but it still works and
still gets maintenance releases for now. Recheck both rows at least quarterly.

## 10. enx-chrome: root `tsc --noEmit` fails on two test files — DONE

Resolved on branch `chore/backlog-small-fixes`: `manifest.test.ts` reads the
stamped manifest through a local `StampedManifest` interface, and the statsReporter test's request mocks
are typed `(endpoint: string, options: RequestInit)`, so no tuple casts.
