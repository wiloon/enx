# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

Layout: **single-context**.

## Before exploring, read these

- **`GLOSSARY.md`** at the repo root (created lazily by `/domain-modeling`).
- **`docs/architecture/`**: read ADRs that touch the area you're about to work in. ADRs are named `adr-NNN-<slug>.md` (e.g. `adr-007-drag-select-sentence-translation.md`). A legacy ADR also lives at `docs/adr/0001-integrate-ecdict-dictionary.md`.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

```
/
├── GLOSSARY.md                         ← lazily created by /domain-modeling
├── docs/architecture/
│   ├── adr-001-chrome-oauth-in-background.md
│   ├── adr-002-word-popup-react-shadow-dom.md
│   └── ...
├── docs/adr/
│   └── 0001-integrate-ecdict-dictionary.md   ← legacy location
├── enx-api/
├── enx-ui/
└── enx-chrome/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `GLOSSARY.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Where things get written

The repo follows the Matt skills: three artifacts, nothing else.

| Artifact | When |
| --- | --- |
| **`GLOSSARY.md` term** | A word got sharp; write it down |
| **ADR** (`domain-modeling`) | Hard to reverse + surprising without context + real trade-off (all three) |
| **GitHub issue** | The work itself: steps, acceptance, multi-phase checklists as the issue's task list or sub-issues (`docs/agents/issue-tracker.md`) |

An ADR Decision plus `tdd` is enough to start coding. `docs/tasks/TASK-SPEC-*.md` files are history: when you touch their area, move anything still live into the ADR or an issue. An older ADR that says「配套 TASK-SPEC 留到编码阶段再写」 is satisfied by an issue.

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts adr-007 (drag-select sentence translation), but worth reopening because…_
