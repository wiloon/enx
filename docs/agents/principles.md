# Owner principles

The owner's (wiloon's) standing decisions. An agent that reviews or revises an issue or ADR, or meets a choice an issue or ADR leaves open, settles it from these principles, the ADRs, `AGENTS.md` and the code, and cites what it used. A question none of them settles goes to the owner, with the options and a recommendation.

Every owner intervention is a chance to grow this file: when the owner answers a question, settles a decision or corrects a PR, check whether the answer generalises beyond the case at hand (it would settle similar choices next time) and isn't here yet, and propose it.

Changes need the owner's approval. In an interactive session, propose the entry and edit the file once the owner agrees. An unattended agent drafts the entry for a PR the owner merges or closes.

## Always the owner's call

Unless a principle below already settles it:

- Product behaviour a user sees, and pricing.
- Money and credit semantics: what is charged, granted, refunded or clawed back, beyond fixing an obvious bug.
- Deleting or migrating production data.
- Security trade-offs.
- Reversing a decision an accepted ADR records.

## Principles

Entry format: `- **P-N short name** (YYYY-MM-DD, source): the rule. Why: the reason.` Numbers are never reused; a retired principle is struck through with the date and why.

### Product

- **P-1 No P2P sync** (2026-09-17, enx-sync suspended): new designs sync through enx-api only; peer-to-peer sync is not an option to weigh. Why: the P2P approach was abandoned.

### Technology

### Process
