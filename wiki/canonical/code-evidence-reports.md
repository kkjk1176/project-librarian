---
status: active
updated: 2026-06-09
scope: project-canonical
read_budget: medium
decision_ref: wiki/decisions/large-project-roadmap-and-metrics.md
review_trigger: architecture report sections, ownership summary, workspace graph, route inventory, dependency hotspots, config inventory, or edge summary changes
---

# Code Evidence Reports

## TL;DR

- `--code-report` is read-only over an existing evidence index.
- Reports summarize evidence coverage, ownership, parser profiles, workspaces, workspace dependency graph, routes, dependencies, configs, and edges.
- Reports preserve evidence paths/line numbers where available so agents can verify before updating canonical wiki truth.

## Architecture And Ownership Report

Code-proven behavior:

- `--code-report` is read-only over an existing evidence index and emits JSON with `schema_version: 1` and the stored `parser_mode`; evidence: `runCodeReportMode`, `codeReportMetadata`, and `codeReport` in `src/code-index.ts`.
- Report sections are `evidence_coverage`, `ownership_summary`, `language_profile_summary`, `parser_backend_summary`, `workspace_summary`, `workspace_dependency_graph`, `route_inventory`, `dependency_hotspots`, `config_inventory`, and `edge_summary`; evidence: `codeReport`.
- `parser_backend_summary` groups indexed files by language/profile and reports backend ID, backend label, extraction strength, file count, lines, and bytes; evidence: `parserBackendSummary`.
- `workspace_summary` reports discovered workspace packages with indexed file counts plus parsed CODEOWNERS rules; evidence: `workspaceSummary`.
- `workspace_dependency_graph` reports discovered workspace packages, package managers, lockfiles, internal workspace dependency edges, and external dependency hotspots; evidence: `workspaceDependencyGraph`.
- `--code-report --code-report-section <section>` emits one bounded section envelope with `section` and `data`; supported section names are coverage, ownership, languages, parsers, workspaces, workspace-graph, routes, hotspots, configs, and edges, with aliases for exact full-report field names; evidence: `selectedCodeReportSection`, `codeReportForRequestedSection`, and `codeReportSectionData` in `src/code-index.ts`.
- Path-derived ownership keys use the first path segment, except common monorepo roots such as `apps/`, `packages/`, `services/`, and `libs/`, where the first two segments are used; evidence: `pathOwnerKey`.
- When a file belongs to a discovered workspace package, ownership keys use the workspace root and mark `owner_source: workspace`; otherwise they keep path-derived ownership with `owner_source: path`; evidence: `ownershipInfo` and `ownershipSummary`.
- The report preserves file paths and line numbers for route/config evidence where available so agents can verify before writing canonical wiki claims.
- Smoke coverage verifies report schema, ownership summary, parser backend summary, workspace summary, workspace dependency graph, route inventory, dependency hotspots, edge summary, bounded route/hotspot/coverage/parser/workspace/workspace-graph sections, impact owner evidence for symbols/modules, missing section values, invalid section rejection, Tree-sitter parser mode indexing across JS/TS/Python/Go/Rust/Java/PHP/Kotlin/Swift/C/C++/C#, and parser-mode mismatch rejection using the code evidence fixture; evidence: `tests/smoke.sh`.
