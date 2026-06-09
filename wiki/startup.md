---
status: active
updated: 2026-06-09
scope: startup-router
read_budget: short
decision_ref: wiki/meta/wiki-ops-v1-decisions.md
review_trigger: session-start summary, routing, language policy, or open project state changes
---

# Startup Context

## TL;DR

- `project-wiki-bootstrap` is a TypeScript CLI for compact repo-local project planning wikis.
- Project truth lives in `wiki/canonical/`, decisions in `wiki/decisions/`, sources in `wiki/sources/`.
- Wiki operating rules and wiki operating decisions live in `wiki/meta/`.
- At session start, read only this file and `wiki/index.md`; load details on demand.
- Current code-backed canonical project pages are written in Korean for this repository context; generated operating templates remain English by default.
- Update the wiki in the same turn when project-planning content changes.

## Read On Demand

- [[index]]: full router.
- [[canonical/project-brief]]: product direction, audience, scope, scenarios.
- [[canonical/open-questions]]: unresolved questions.
- [[canonical/risks]]: risks and revisit triggers.
- [[canonical/distribution-and-verification]]: distribution/verification overview.
- [[canonical/benchmark-and-release-evidence]]: benchmark metrics, release claims, baseline deltas.

## Project State

- Product: npm CLI `project-wiki-bootstrap`; TypeScript source in `src/`, committed runtime output in `dist/`.
- Current npm latest: `project-wiki-bootstrap@0.1.2`.
- Problem: token-efficient planning wiki with compact routing for small repos, large projects, and monorepos.
- Users: Codex/Claude Code developers and teams, including large-repo teams.
- Scenario: bootstrap/update `./wiki`, agent instructions, hooks, diagnostics, scoped routing, optional code evidence.
- Success: idempotent bootstrap, preservation-first edits, compact hooks, diagnostics, migration copy-risk detection, scoped routing, code evidence.
- Large-project state: incremental indexing, code reports, Tree-sitter mode, workspace graph/CODEOWNERS, scoped routing, and v9 benchmarks exist; deeper semantic extraction remains next.
- Measurement policy: metrics are maintainer release evidence, not public CLI workflow.
- Project content language: Korean for current code-backed canonical pages unless the user or project context changes it.

## Recent Project Decisions

- 2026-06-08: npm publication is official; `0.1.2` is current `latest`. See [[decisions/npm-release-policy]].
- 2026-06-08: installed skills prefer local `dist/init-project-wiki.js` over network `npx`. See [[decisions/npm-release-policy]].
- 2026-06-09: large projects/monorepos are first-class targets; metrics are release evidence; approved issue creation uses `--issue-create`; migration rewrites, not copies, legacy markdown. See [[decisions/large-project-roadmap-and-metrics]], [[decisions/log]].
- 2026-06-09: package minimum Node is `>=22.13` for stable `node:sqlite` across CLI/skill runners. See [[canonical/package-release-contract]], [[decisions/log]].

## Wiki Operating Pointers

- Decision recording follows [[meta/decision-policy]].
- Wiki operation follows [[meta/operating-model]].
- Wiki operating decisions are recorded only in [[meta/wiki-ops-v1-decisions]], not in project decision logs.

## Token Discipline

- The Codex and Claude Code session-start hooks inject only this file and `wiki/index.md`.
- Detailed files are selected by `wiki/index.md`.
- Long decision history is not injected wholesale; read only relevant Decision Packs or ADRs.
