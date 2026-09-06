# AI Agents

This document provides guidance for AI agent interactions with this project.

## Overview

This project uses AI assistance for development tasks including code generation, refactoring, documentation, and optimization.

## Getting Started (For New Sessions)

**IMPORTANT:** When starting a new Copilot session, you MUST read the following files first:

1. **Read [.ai/instructions.md](.ai/instructions.md)** - Contains project-specific coding conventions, guidelines, and AI interaction patterns
2. **Review [.ai/contributions.md](.ai/contributions.md)** - Historical context of AI contributions and lessons learned

These documents are essential for maintaining consistency with project standards and understanding the codebase architecture.

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

Single-context layout: one root `CONTEXT.md` (created lazily) plus ADRs in `docs/architecture/`. See `docs/agents/domain.md`.

---

*For AI guidelines, see [.ai/instructions.md](.ai/instructions.md)*
