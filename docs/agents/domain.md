# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

Layout: **single-context**.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root (does not exist yet; `/domain-modeling` creates it lazily).
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
└── enx-sync/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts adr-007 (drag-select sentence translation), but worth reopening because…_
