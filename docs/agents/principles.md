# Owner principles

The owner's (wiloon's) standing decisions. An agent that reviews or revises an issue or ADR, or meets a choice an issue or ADR leaves open, settles it from these principles, the ADRs, `AGENTS.md` and the code, and cites what it used. A question none of them settles goes to the owner, with the options and a recommendation.

Entries are added only when the owner asks for one, in an interactive session (owner decision, 2026-10-22). An owner answer or correction settles its own case; it becomes a principle when the owner says so.

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
- **P-6 Brand colour leads the UI** (2026-10-21, #274): everything a user sees, in enx-ui (site and app) and enx-chrome (popup, side panel, word popover), is coloured around the Catglish brand teal; a new or restyled element starts from the brand palette, not a component library's neutral default. A change that touches a page or surface brings that page onto the brand palette in the same PR; untouched pages wait their turn. The rules are in [ui-design.md](ui-design.md). Why: the brand colour is how people recognise Catglish, and screens left in library defaults look like someone else's product.
- **P-7 A lookup counts wherever it happens** (2026-10-21, #274): a word the user looks up is recorded the same way on every surface (a click in an article, the side panel, enx-ui's `/lookup`, any surface added later) and for every role, admins included. It joins the Word List and the vocabulary count, is underlined for review on every site, loses its "known" mark, and uses one unit of the daily lookup quota. Why: the point is to record which words the user doesn't know, and looking a word up anywhere says they don't; the quota is generous enough for that use.

### Technology

- **P-5 A test must check something** (2026-10-21, #265): a test that can pass without checking anything (an ignored error, an assertion on a value nothing sets) is a Must fix in review: make it check something, or delete it. Why: a test that checks nothing gives false confidence; it stays green when the behaviour it claims to pin breaks.

### Process

- **P-2 A PR does its issue** (2026-10-21, #254; own-code nits 2026-10-27): a PR carries only what its issue asks for. Unrelated problems found while implementing or reviewing stay out of it: a nit or small cleanup goes into the PR's follow-up issue (label `follow-up`), a real bug gets its own issue (`needs-triage`). A nit on code the PR itself adds or changes is not unrelated: when it is worth doing, review lists it as Must fix and the PR fixes it before merge; otherwise it is dropped. So a follow-up issue holds only findings in code the PR leaves untouched. Why: small PRs keep reviews focused, and side findings are recorded instead of lost; a PR's own rough edges are cheapest to fix while it is open, and filing them leaves a trail of trivial issues.
- **P-3 Code work in GitHub, owner actions in Linear** (2026-10-21, #250): anything that changes code (a bug, a follow-up, a feature) is a GitHub issue in wiloon/enx. Anything only the owner can do (a secret on a host, a Stripe or Clerk dashboard change, a manual browser check, tagging a release) is a Linear task in team WIL, project ENX, linking the PR or issue it comes from. Record each item in one place, not both. Why: code work stays next to its PRs where agents pick it up; owner actions land in the owner's schedule; one record means one place to close it.
