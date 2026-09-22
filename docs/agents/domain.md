# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

Layout: **single-context**.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root (created lazily by `/domain-modeling`).
- **`docs/architecture/`**: read ADRs that touch the area you're about to work in. ADRs are named `adr-NNN-<slug>.md` (e.g. `adr-007-drag-select-sentence-translation.md`). A legacy ADR also lives at `docs/adr/0001-integrate-ecdict-dictionary.md`.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

```
/
├── CONTEXT.md                         ← lazily created by /domain-modeling
├── docs/architecture/
│   ├── adr-001-chrome-oauth-in-background.md
│   ├── adr-002-word-popup-react-shadow-dom.md
│   └── ...
├── docs/adr/
│   └── 0001-integrate-ecdict-dictionary.md   ← legacy location
├── enx-api/
├── enx-ui/
├── enx-chrome/
└── enx-sync/                          ← P2P 同步，暂停维护（2026-09-17）；新设计不考虑 P2P
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## ADR vs TASK-SPEC vs coding (not a Matt gate)

Matt skills (`domain-modeling`, architecture, TDD) do **not** require a `docs/tasks/TASK-SPEC-*.md` before coding.

| Artifact | When |
| --- | --- |
| **`CONTEXT.md` term** | A word got sharp; write it down |
| **ADR** | Hard to reverse + surprising without context + real trade-off (all three) |
| **GitHub issue** | Track work / triage (`docs/agents/issue-tracker.md`) |
| **`TASK-SPEC-*.md`** | **Optional** long implementation note when an ADR alone would be unreadably huge (billing cutover, multi-phase infra). Precedent: [adr-012](../architecture/adr-012-enx-ui-idiomatic-rephrasing.md) Decision 10 and [adr-015](../architecture/adr-015-cognito-to-clerk-auth-migration.md) ship from the ADR + TDD with no coding-time TASK-SPEC |

If an older ADR says「配套 TASK-SPEC 留到编码阶段再写」, treat that as historical habit, not a mandatory step. Prefer amending the ADR's Decision (or a short GitHub issue) over inventing a TASK-SPEC just to unlock coding.

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts adr-007 (drag-select sentence translation), but worth reopening because…_
