# AI Agents

## Before the first code change

Read [.ai/instructions.md](.ai/instructions.md) before the first code change of a session. Unlike this file it is **not** loaded automatically. It holds the language rules, the DDD layering with examples, the ECDICT read-only rules and the testing rules. [.ai/contributions.md](.ai/contributions.md) is the history of past AI work; read it when a change touches an area whose past lessons matter.

### enx-api (Go): rules for every change

- **DDD layering.** Handlers do HTTP only. Business rules live in domain services and entities (`enx/`, or a domain package such as `dictionary/`). SQL lives in `repo/`. A domain service receives its repositories and data sources as interfaces through a constructor, so its unit tests run on fakes with no database. Plain CRUD stays plain.
- **Coverage before refactoring.** Measure it first (`go test -cover ./<pkg>`). Where behaviour is uncovered, write characterization tests that pin today's behaviour, then refactor. Precedent: #22 went in before the ADR-018 deep seam.
- **Every functional change ships with tests**: unit by default, `//go:build integration` for real-DB or full-HTTP flows.
- **ECDICT is read-only.** It is a separate third-party SQLite file opened `mode=ro`. Migrations, cleanups and fixes touch only the application database; corrections to ECDICT data go into application tables (`words`, …), never into ECDICT. Details: `.ai/instructions.md` §External Data Sources.
- **One word-lookup entry point:** `dictionary.Service.Resolve` (ADR-018), wired in `main`. User lookups go through it, never straight to `words` or `ecdict`.

## Documentation

| File | Purpose |
|------|---------|
| [.ai/instructions.md](.ai/instructions.md) | AI guidelines and coding conventions (auto-loaded by Copilot) |
| [.ai/contributions.md](.ai/contributions.md) | Historical record of AI contributions |

## Agent skills

### Issue tracker

Issues and specs are tracked as GitHub issues in `wiloon/enx` (via the `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: one root `CONTEXT.md` (created lazily) plus ADRs in `docs/architecture/`. See `docs/agents/domain.md`. A new ADR takes the next number unused on **every** branch and worktree (`git fetch && git log --all --name-only --format= -- docs/architecture | sort -u`), not just on `main`.

**TASK-SPEC is optional** — Matt skills do not require `docs/tasks/TASK-SPEC-*.md` before coding; ADR Decision + TDD is enough unless the work needs a long multi-phase checklist. Details in `docs/agents/domain.md` §ADR vs TASK-SPEC.

---

*For AI guidelines, see [.ai/instructions.md](.ai/instructions.md)*
