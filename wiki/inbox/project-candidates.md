---
status: active
updated: 2026-06-09
scope: inbox
read_budget: on-demand
decision_ref: wiki/meta/wiki-ops-v1-decisions.md
review_trigger: candidates are adopted, rejected, or stale
---

# Project Candidates Inbox

## TL;DR

- This file temporarily stores project-canonical candidates from conversation.
- This file is not canonical truth.
- After review, move useful content into canonical/decision/source/meta docs or mark it rejected/resolved.

| Date | Title | Category | Content | Status |
| --- | --- | --- | --- | --- |
| 2026-06-08 | Wiki quality diagnostics and document-improvement features | product-improvement | Adopted through `--link-check`, `--quality-check`, and `--doctor`: broken wikilink checks, duplicate route detection, orphan/unrouted page reports, stale/unresolved content signals, source/evidence coverage checks, and actionable diagnostic messages are implemented. No separate numeric quality score is part of the current code. | adopted |
| 2026-06-08 | GitHub issue export for wiki and code improvements | product-improvement | Rejected as a primary feature direction: exporting local modification history to GitHub issues does not match the skill's support workflow. Prefer an issue-reporting workflow for problems, side effects, regressions, confusing behavior, or edge cases discovered while using the skill. | rejected |
| 2026-06-08 | GitHub issue report for skill problems and side effects | product-improvement | Adopted as read-only `--issue-draft` Markdown output for problems, side effects, regressions, confusing behavior, or generated-file surprises found while using the skill. The draft includes reproduction steps, expected vs actual behavior, environment, affected generated files, side effects, risk, and validation evidence. | adopted |
| 2026-06-09 | Large-repo incremental code evidence index | product-improvement | Implemented in the code evidence index: compatible `--code-index` reruns update incrementally, `--code-index --incremental` requires an existing compatible cache and fails instead of rebuilding when missing or incompatible, and `--code-index --code-index-full` forces a full rebuild. Measurement remains part of benchmark/release evidence. | adopted |
| 2026-06-09 | Multi-language parser backend for large repositories | product-improvement | Implemented initial optional Tree-sitter parser mode: `--code-index --code-parser tree-sitter` switches JS/TS/TSX/Python/Go source files to `tree-sitter-*` structural profiles using optional `@sengac/tree-sitter*` packages. Default bootstrap and default parser mode remain separate; broader language coverage and benchmark measurement remain future work. | adopted |
| 2026-06-09 | Large-repo architecture and ownership summaries | product-improvement | Partially implemented as generated read-only `--code-report` output and bounded `--code-report --code-report-section <section>` views for ownership, dependency hot spots, route/API inventories, config summaries, edges, languages, and coverage. Changed-area impact queries remain a future report surface. | adopted |
| 2026-06-09 | Monorepo-aware wiki routing | product-improvement | Adopted as roadmap direction: add first-class support for multi-package and multi-app repositories through scoped startup routers, package-level canonical pages, bounded code scopes, and per-scope diagnostics. Measurement must prove compact startup/index remains much smaller than full wiki reads. | adopted |
| 2026-06-09 | Parser backend split for large code evidence | product-improvement | Implemented as a code evidence parser backend registry plus `parser_backend_summary` report section while preserving the default TypeScript compiler API, lightweight regex, config, and inventory backends. Optional Tree-sitter mode now exists for cross-language structural extraction; Oxc-style JS/TS speed evaluation remains pending. | adopted |
| 2026-06-09 | Space-efficient searchable code cache | product-improvement | Candidate: reduce `.project-wiki/code-evidence.sqlite` size and query latency by moving file bodies out of duplicated FTS rows or using external/contentless FTS5 patterns, while preserving exact path/line evidence. Measure database size, query latency, and report generation on the large code-heavy benchmark before adoption. | pending |
| 2026-06-09 | Workspace graph and ownership adapters | product-improvement | Implemented for code evidence reports: root `package.json` workspaces produce workspace packages, `ownership_summary` prefers workspace roots over path heuristics, `workspace_summary` reports package and CODEOWNERS signals, and CODEOWNERS matches are attached as ownership hints. Deeper package-manager graph semantics remain future work. | adopted |
| 2026-06-09 | Parallel and resumable indexing | product-improvement | Candidate: for very large repositories, split discovery, hashing, parsing, and SQLite writes into a bounded pipeline with resumable checkpoints. Preserve deterministic output and fail with real errors rather than fallback behavior. Benchmark should include at least tens of thousands of files, not only the current synthetic 1.4k-file code-heavy fixture. | pending |
| 2026-06-09 | Watchman-backed changed-file discovery | product-improvement | Candidate: evaluate Watchman as an optional accelerator for very large repositories where repeated full file discovery and hashing dominate incremental code indexing. Keep git-based discovery as the deterministic default and require explicit availability checks, exact error reporting, and benchmark evidence before adoption. | pending |
| 2026-06-09 | ripgrep-backed search and file listing surfaces | product-improvement | Candidate: evaluate `rg` as an optional fast path for project text search or file-listing workflows that should honor ignore files. Preserve Node/git implementations as the portable baseline unless benchmarks show meaningful latency wins and output parity. | pending |
| 2026-06-09 | Wiki document body split guidance | product-improvement | Candidate: add explicit guidance or diagnostics for splitting oversized canonical, decision, startup, and meta pages when `read_budget` drift appears. Split by reader intent, review trigger, volatility, evidence source, and whether a task can route to the child page independently; do not split by character count alone. Current design supports manual topic splits, read-on-demand routing, `--refresh-index`, scoped generated routers for many pages, and `budget-drift` warnings, but does not automatically rewrite one large document into focused documents. | pending |
