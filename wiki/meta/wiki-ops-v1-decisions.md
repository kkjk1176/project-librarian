---
status: active
updated: 2026-06-09
scope: wiki-meta-decisions
read_budget: medium
decision_ref: self
review_trigger: wiki operation, metadata, lint, migration, language policy, or storage-boundary decisions change
---

# Wiki Operations v1 Decisions

## TL;DR

- This Decision Pack records accepted wiki operating choices for project-wiki-bootstrap.
- It covers wiki structure, startup hook scope, metadata, language policy, git hook behavior, migration review, and inbox handling.
- Project product decisions belong in `wiki/decisions/`, while these operating decisions stay in `wiki/meta/`.

Status: accepted
Scope: wiki operation
Canonical: [[meta/operating-model]], [[meta/decision-policy]]

| Date | Decision | Rationale | Rejected Alternative | Revisit Trigger | Canonical Link |
| --- | --- | --- | --- | --- | --- |
| 2026-06-09 | Keep the wiki root at `./wiki`. | Planning docs live with the project. | External docs only. | Another tool cannot read `./wiki` or the team needs another path. | [[meta/operating-model]] |
| 2026-06-09 | Split `canonical/` and `decisions/`. | Current truth and decision history are easier to scan when separated. | A single mixed docs directory. | The structure proves too heavy for small projects. | [[meta/decision-policy]] |
| 2026-06-09 | Inject only `startup.md` and `index.md` through Codex and Claude Code startup hooks; route detailed files Read On Demand. | Full canonical and decision bodies waste startup tokens. | Always read detailed canonical and decision files first. | Important context is repeatedly missed at startup. | [[startup]], [[index]] |
| 2026-06-09 | Use metadata headers on wiki knowledge pages. | Agents and humans can quickly judge status, scope, budget, and review triggers. | Body-only conventions. | Header maintenance costs more than it saves. | [[meta/operating-model]] |
| 2026-06-09 | Keep wiki operating docs in `wiki/meta/`. | Project truth stays focused on product/project content. | Store operating docs in `canonical/` or `decisions/`. | Meta docs become hard to discover. | [[meta/operating-model]] |
| 2026-06-09 | Bootstrap-generated operating documents are English by default. | Repository entry points and operating contracts are easier for public users to inspect. | Generate operating docs in a fixed non-English language. | The project intentionally targets a single-language local audience. | [[meta/operating-model]] |
| 2026-06-09 | Project canonical content language is chosen from user/project context. | User language and source material should drive project truth, not the bootstrap tool. | Hardcode Korean or English as the canonical content language. | A team requires a fixed language policy. | [[startup]], [[index]] |
| 2026-06-09 | Install git hook files but preserve existing `core.hooksPath` values and allow `--no-git-config`. | Public users may already have a hook chain such as Husky. | Always replace `core.hooksPath`. | Users prefer automatic setup and accept the side effect. | [[meta/operating-model]] |
| 2026-06-09 | Commit automation writes the `Wiki-scope` trailer. | Reviewers should see whether a commit touched startup, canonical docs, decisions, or wiki operations. | Leave wiki impact implicit in the diff. | Trailer format becomes too noisy. | [[meta/operating-model]] |
| 2026-06-09 | Migration may mark rows `needs-human-review`. | Ambiguous, risky, or high-impact legacy content should not be closed automatically. | Force every migrated row into adopted/rejected/resolved. | Human review queues become too large. | [[meta/operating-model]] |
| 2026-06-09 | Capture stores candidates in `wiki/inbox/`. | Useful ideas are not lost, but unreviewed content does not become canonical truth. | Save all conversation content directly into canonical docs. | Inbox content is frequently abandoned. | [[meta/operating-model]] |
