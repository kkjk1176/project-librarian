---
status: active
updated: 2026-06-10
scope: startup-router
read_budget: short
decision_ref: wiki/meta/wiki-ops-v1-decisions.md
review_trigger: session-start summary, routing, language policy, or open project state changes
---

# Startup Context

## TL;DR

- TypeScript CLI for compact repo-local planning wikis plus optional code evidence indexing.
- Project truth: `wiki/canonical/`; decisions: `wiki/decisions/`; sources: `wiki/sources/`; wiki ops: `wiki/meta/`.
- At session start, read only this file and `wiki/index.md`; load details on demand.
- Current code-backed canonical project pages are written in Korean for this repository context; generated operating templates remain English by default.
- Update the wiki in the same turn when project-planning content changes.

## Read On Demand

- [[index]]: full router.
- [[canonical/project-brief]]: product direction, audience, scope, scenarios.
- [[canonical/open-questions]]: unresolved questions.
- [[canonical/risks]]: risks and revisit triggers.
- [[canonical/distribution-and-verification]]: distribution/verification.

## Project State

- Product: npm CLI `project-librarian`; source in `src/`, runtime in `dist/`.
- Rename release: `project-librarian@0.2.0` is published on npm; current source version is `0.2.1` for benchmark-evidence documentation correction.
- GitHub remote is `kkjk1176/project-librarian`; npm registry latest is `project-librarian@0.2.0` until `0.2.1` publishes.
- Problem: token-efficient planning wiki with compact routing for small repos, large projects, and monorepos.
- Users: Codex, Claude Code, Cursor, Gemini CLI developers/teams.
- Scenario: bootstrap/update `./wiki`, agent instructions, hooks/rules, diagnostics, scoped routing, optional code evidence.
- Success: idempotent bootstrap, preservation-first edits, compact hooks, diagnostics, migration copy-risk detection, scoped routing, code evidence.
- Large-project state: incremental indexing, code reports, Tree-sitter, workspace graph/CODEOWNERS, scoped routing, v9 benchmarks.
- Measurement: metrics are release evidence; token claims are Markdown context avoided, not actual LLM use.
- Actual LLM benchmark planning: Codex-only measured with/without Project Librarian comparisons are routed through [[canonical/benchmark-and-release-evidence]].
- Project content language: Korean unless user/project context changes it.

## Recent Decisions

- npm publication is official; old name `project-wiki-bootstrap@0.1.2` is superseded by `project-librarian@0.2.0`.
- Installed skills prefer local `dist/init-project-wiki.js` over network `npx`. See [[decisions/npm-release-policy]].
- Large projects/monorepos, release metrics, `--issue-create`, rewrite-not-copy migration, and Node `>=22.13` are adopted. See [[decisions/log]].
- Product/package/CLI/repo renamed to Project Librarian / `project-librarian` for `0.2.0`. See [[decisions/npm-release-policy]].
- Cursor/Gemini support uses Cursor rules, Cursor/Gemini hooks, `GEMINI.md`, and `install-skill --agents all`.

## Wiki Operating Pointers

- Decision recording follows [[meta/decision-policy]].
- Wiki operation follows [[meta/operating-model]].
- Wiki operating decisions are recorded only in [[meta/wiki-ops-v1-decisions]], not in project decision logs.

## Token Discipline

- Codex, Claude Code, Cursor, and Gemini CLI session-start hooks inject only this file and `wiki/index.md`.
- Detailed files are selected by `wiki/index.md`.
- Long decision history is not injected wholesale; read only relevant Decision Packs or ADRs.
