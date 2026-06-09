---
status: active
updated: 2026-06-09
scope: project-canonical
read_budget: medium
decision_ref: wiki/decisions/large-project-roadmap-and-metrics.md
review_trigger: code query safety, stale index behavior, impact mode, or incremental update compatibility changes
---

# Code Evidence Query And Updates

## TL;DR

- Query mode is intentionally read-only and blocks mutating-looking SQL.
- Existing-index inspection reports stale cache warnings when file sets or hashes diverge.
- Compatible `--code-index` reruns update incrementally; explicit incremental mode fails rather than rebuilding when compatibility is missing.

## Query And Staleness

Code-proven behavior:

- `--code-query` requires SQL starting with `SELECT` or `WITH`, rejects multiple statements, and blocks mutating or schema-changing keywords such as `insert`, `update`, `delete`, `drop`, `pragma`, and `vacuum`; evidence: `isReadOnlySql` in `src/code-index-sql.ts`.
- Query mode opens SQLite with `PRAGMA query_only = ON`; evidence: `runCodeQueryMode`.
- `--code-status`, `--code-files`, `--code-report`, `--code-impact`, and `--code-search-symbol` require an existing index and report stale-file warnings when the current file set or hashes differ from indexed metadata; evidence: `requireExistingIndex`, `codeIndexStaleness`, and `warnIfCodeIndexStale`.
- `--code-impact <term>` emits a bounded JSON envelope with matching files, symbols, routes, imports, outgoing edges, incoming edges, route edges, and impacted owner hints for the target term; evidence: `codeImpact`, `ownershipInfo`, and `runCodeImpactMode`.

## Incremental Update Behavior

Code-proven behavior:

- A compatible rerun prints `mode: incremental`, `reindexed_files`, `deleted_files`, and `unchanged_files`; evidence: `runCodeIndexMode` in `src/code-index.ts`.
- Incremental mode discovers the current scoped file set, hashes files, deletes stale rows from file-owned tables and FTS tables, then indexes only changed or added files; evidence: `removeIndexedFile`, `indexCodeFile`, and `runCodeIndexMode`.
- Plain `--code-index` keeps the compatibility contract: new databases, scope changes, or incompatible schema metadata are rebuilt as `mode: full`; evidence: `runCodeIndexMode`.
- `--code-index --incremental` makes changed-file-only updates explicit and fails when the existing database is missing or incompatible, including parser-mode mismatch, instead of rebuilding; evidence: `codeIndexIncrementalMode`, `incrementalCompatibility`, and `runCodeIndexMode`.
- `--code-index --code-index-full` forces a full rebuild even when the existing database is compatible; evidence: `codeIndexFullMode` and `runCodeIndexMode`.
- Smoke coverage verifies a changed file, added file, and deleted file become fresh after an explicit incremental run, rejects missing or mismatched incremental indexes, and verifies forced full rebuild output; evidence: `tests/smoke.sh`.
