# AI Agents

## Worktree by default

Another agent may be working in the main checkout at the same time. A session that will change files does its work in a git worktree:

- **New task:** before the first file change, create a worktree branched from `origin/main` (in Claude Code, the `EnterWorktree` tool) and rename its branch to the usual `feat/…`, `fix/…`, `docs/…` form.
- **Continuing an existing branch:** work where that branch is already checked out, or add a worktree for it.
- **Read-only sessions** (questions, code reading, reviews) stay in the main checkout.
- **Env files:** Claude Code copies the files listed in `.worktreeinclude` into new worktrees. Other tools copy `enx-api/.env`, `enx-chrome/.env` and `enx-ui/.env.local` from the main checkout by hand.
- **After the PR merges:** remove the worktree and delete its local branch. Then, in the main checkout, switch to `main` and run `git pull --ff-only`. Do this yourself; don't just tell the user that local `main` is behind. Claude Code's `ExitWorktree` treats a branch merged by a merge commit as unmerged. Check with `git merge-base --is-ancestor <commit> origin/main`, then remove the worktree with `discard_changes: true`.

## Language

- **Code, comments, config, docs:** English. ADRs in `docs/architecture/` are Chinese by convention; match the language of the doc you edit.
- **UI copy in `enx-chrome` and `enx-ui`:** English, including every hint, toast and error, and the `message` strings enx-api returns for display. Chinese UI copy is a bug; fix it in place. The one exception is language-learning content aimed at the Chinese-speaking user (e.g. the notes from "地道表达", ADR-012).

## Working with Matt skills

The `mattpocock-skills` plugin is installed. Run the matching skill rather than improvising the process:

| Work | Skill |
|------|-------|
| Any code change: feature or bug fix | `tdd` |
| Something broken, throwing or slow, cause unknown | `diagnosing-bugs` |
| An ADR, a `GLOSSARY.md` term, naming a domain concept | `domain-modeling` |
| Designing a module's interface or where a seam goes | `codebase-design` |
| Stress-testing a plan before building it | `grilling` |
| Answering a design question with throwaway code | `prototype` |
| Reviewing a branch or PR | `code-review` |
| Editing this file, a skill, or any doc agents read | `writing-for-agents` |

## Tests: every sub-project

These rules hold for all code: enx-api, enx-ui and enx-chrome alike.

- **Red, green, refactor, in small steps.** Write one failing test for the next behaviour, watch it go red, write the least code that turns it green, then refactor with the suite green. A bug fix starts with a test that reproduces the bug and is red on today's code.
- **Prove the red.** A test that passes on the old code proves nothing. If you wrote the fix first, revert it temporarily and watch the new test fail before you finish.
- **One test per behaviour, not per function.** Every behaviour a change adds or alters gets a test that asserts on outputs and visible effects, so a refactor that keeps the behaviour keeps the tests green. Config, build and docs-only changes need none.
- **Coverage before refactoring.** Measure it first (`go test -cover`, `pnpm test -- --coverage`). Where behaviour is uncovered, write characterization tests that pin today's behaviour, then refactor. Precedent: #22 went in before the ADR-018 deep seam.
- **jsdom locks logic only.** It has no layout, no painting and no colours. Layout, positioning, overflow, scrollbars, colour and animation need Playwright in a real browser. Where Playwright can't run them, the PR lists manual checks, and your reply says plainly what you did not see in a browser.
- **Done means:** the sub-project's suite, typecheck, lint and build pass. Every skipped test (e.g. e2e without Clerk credentials) is named in the PR.

Test types, where tests live, commands and e2e sign-in: [docs/agents/testing.md](docs/agents/testing.md).

## Domain-driven design: every sub-project

All three sub-projects keep the domain apart from the machinery around it:

- **Ubiquitous language.** Name types, functions, tests and UI states with the terms in [GLOSSARY.md](GLOSSARY.md) and the ADRs. A missing or fuzzy term goes through `domain-modeling` before it spreads into code.
- **A domain core free of frameworks and I/O.** Business rules (what counts as a lookup, when a word is known, how credits are spent, where an overlay goes) live in plain modules that import no HTTP, SQL, React, `chrome.*`, `fetch` or DOM globals. In enx-api that is the domain packages; in enx-ui and enx-chrome it is `src/lib/` (e.g. `wordHighlight.ts`, `aiLookupFlow.ts`, `credits.ts`).
- **I/O enters through the constructor or the parameter list.** Repositories, API clients, `chrome.*` wrappers, storage and the browser's geometry are passed in, so the core runs in unit tests on fakes (`overlayPositioning.ts` takes the Floating UI platform).
- **Edges stay thin.** Gin handlers, React components, the content script, the background worker and the side panel translate events into domain calls and results into responses or rendering. A rule found inside one is moved out into the core.
- **Legacy files shrink as you touch them.** `content.tsx`, `SidePanel.tsx` and `background.ts` still mix rules with wiring. When a change lands in one, pin the behaviour you touch with tests, then move that rule into `src/lib/`; leave the rest for its own change.
- **Plain stays plain.** A CRUD endpoint or a static view gets no service layer for its own sake.

## enx-api (Go)

- **DDD layering.** Handlers do HTTP only. Business rules live in domain services and entities (`enx/`, or a domain package such as `dictionary/`). SQL lives in `repo/`. A domain service receives its repositories and data sources as interfaces through a constructor, so its unit tests run on fakes with no database. Plain CRUD stays plain. Examples: [docs/agents/enx-api-design.md](docs/agents/enx-api-design.md).
- **ECDICT is read-only.** It is a separate third-party SQLite file opened `mode=ro`. Migrations, cleanups and fixes touch only the application database; corrections to ECDICT data go into application tables (`words`, …), never into ECDICT.
- **One word-lookup entry point:** `dictionary.Service.Resolve` (ADR-018), wired in `main`. User lookups go through it, never straight to `words` or `ecdict`.
- **Logging:** one structured request line per request comes from `middleware.RequestLog`; read [docs/agents/logging.md](docs/agents/logging.md) before adding log lines.

## Reference docs

| File | Read it when |
|------|--------------|
| [docs/agents/principles.md](docs/agents/principles.md) | reviewing or revising an issue or ADR; deciding something an issue or ADR leaves open; the owner just settled a decision (propose it as a principle) |
| [docs/agents/testing.md](docs/agents/testing.md) | choosing a test type, running e2e, signing in for e2e |
| [docs/agents/enx-api-design.md](docs/agents/enx-api-design.md) | adding an enx-api domain service, repository or entity |
| [docs/agents/logging.md](docs/agents/logging.md) | adding or changing enx-api log lines |
| [docs/agents/adding-website-support.md](docs/agents/adding-website-support.md) | making the extension work on a new website |
| [docs/agents/icons.md](docs/agents/icons.md) | placing or changing an icon in enx-ui or enx-chrome |
| [docs/agents/contributions.md](docs/agents/contributions.md) | a change touches an area whose past lessons matter; add an entry after significant work |

## Agent skills

### Issue tracker

Issues and specs are tracked as GitHub issues in `wiloon/enx` (via the `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: one root `GLOSSARY.md` (created lazily) plus ADRs in `docs/architecture/`. See `docs/agents/domain.md`. A new ADR takes the next number unused on **every** branch and worktree (`git fetch && git log --all --name-only --format= -- docs/architecture | sort -u`), not just on `main`.

**TASK-SPEC is optional**: an ADR Decision plus TDD is enough unless the work needs a long multi-phase checklist. Details in `docs/agents/domain.md` §ADR vs TASK-SPEC.
