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

- **P-5 A test must check something** (2026-10-21, #265): a test that can pass without checking anything (an ignored error, an assertion on a value nothing sets) is a Must fix in review: make it check something, or delete it. Why: a test that checks nothing gives false confidence; it stays green when the behaviour it claims to pin breaks.

### Process

- **P-2 A PR does its issue** (2026-10-21, #254): a PR carries only what its issue asks for. Unrelated problems found while implementing or reviewing stay out of it: a nit or small cleanup goes into the PR's follow-up issue (label `follow-up`), a real bug gets its own issue (`needs-triage`). Why: small PRs keep reviews focused, and side findings are recorded instead of lost.
- **P-3 Code work in GitHub, owner actions in Linear** (2026-10-21, #250): anything that changes code (a bug, a follow-up, a feature) is a GitHub issue in wiloon/enx. Anything only the owner can do (a secret on a host, a Stripe or Clerk dashboard change, a manual browser check, tagging a release) is a Linear task in team WIL, project ENX, linking the PR or issue it comes from. Record each item in one place, not both. Why: code work stays next to its PRs where agents pick it up; owner actions land in the owner's schedule; one record means one place to close it.
- **P-4 Review by the other model** (2026-10-21, #262): every review step (an issue's spec review, a PR's code review) is done by a model other than the author's: Cursor reviews what the owner and Claude wrote, and Claude reviews what Cursor wrote. Before changing anything, the author's side answers every point: adopted, or rejected with a reason. Why: a fresh context and a different model catch what the author's session reads past.
