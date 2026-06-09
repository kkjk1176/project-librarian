---
status: active
updated: 2026-06-09
scope: project-canonical
read_budget: medium
decision_ref: none
review_trigger: code index schema, supported languages, safety rules, staleness detection, or Node runtime requirement changes
---

# Code Evidence Index

## TL;DR

- Code evidence indexing is optional and writes a regenerable SQLite cache under `.project-wiki/`.
- The package requires Node `>=22.13` so code evidence can use stable `node:sqlite` without experimental flags and installed skill runners share one runtime policy.
- The index stores files, symbols, imports, routes, configs, edges, metadata, and FTS tables for evidence search.
- Default indexing uses TypeScript compiler API, lightweight Python/Go extraction, config extraction, and inventory rows.
- Optional Tree-sitter mode expands structural extraction for supported JS/TS/TSX/Python/Go/Rust/Java/PHP/Kotlin/Swift/C/C++/C# files.
- Compatible reruns of `--code-index` update incrementally; explicit incremental mode fails instead of rebuilding when compatibility is missing.
- Code evidence is support for canonical wiki updates, not canonical truth by itself.

## Storage And Scope Boundaries

Code-proven behavior:

- The default database path is `.project-wiki/code-evidence.sqlite`; evidence: `codeIndexOutput` in `src/args.ts` and `codeEvidenceDatabasePath` in `src/code-index.ts`.
- Custom `--code-index-out` paths must stay inside `.project-wiki/`; evidence: `codeEvidenceDatabasePath` in `src/code-index.ts`.
- `--code-scope` inputs must resolve inside the project root; evidence: `normalizeProjectRelative` in `src/code-index.ts`.
- `.project-wiki/.gitignore` is written as `*` plus `!.gitignore`, making the cache disposable by default; evidence: `prepareOutputPath` in `src/code-index.ts`.

## Discovery Rules

Code-proven behavior:

- In git repositories, file discovery uses `git ls-files --cached --others --exclude-standard`; evidence: `gitTrackedAndUnignoredFiles` in `src/code-index.ts`.
- Fallback traversal skips `.git`, `.codex`, `.claude`, `.project-wiki`, `node_modules`, `.next`, `dist`, `build`, `coverage`, `vendor`, `tmp`, and `temp`; evidence: `ignoredDirectories` in `src/code-index-file-policy.ts`.
- `.env*` files are excluded except `.env.example`; obvious sensitive config filenames such as secret, credential, token, private, or key files are also excluded; evidence: `shouldIndexFile` and `fileLanguage` in `src/code-index-file-policy.ts`.
- Files larger than 1 MiB are not indexed; evidence: `maxIndexedBytes` in `src/code-index-file-policy.ts`.

## Schema Overview

Code-proven behavior:

- The SQLite schema includes `meta`, `files`, `symbols`, `imports`, `routes`, `configs`, `edges`, plus FTS tables for files and symbols; evidence: `setupDatabase` in `src/code-index.ts`.
- The schema stores `schema_version` and `parser_mode` meta values. `--code-index` uses incremental mode only when the existing database schema, indexed scopes, and parser mode match the requested run; evidence: `codeIndexSchemaVersion`, `writeIndexMetadata`, `indexedParserMode`, `incrementalCompatibility`, and `runCodeIndexMode` in `src/code-index.ts`.

## Read On Demand

- [[canonical/code-evidence-extraction]]: parser backends, language extraction, workspace and CODEOWNERS adapters.
- [[canonical/code-evidence-query-and-updates]]: SQL safety, staleness, impact mode, and incremental update behavior.
- [[canonical/code-evidence-reports]]: architecture, ownership, parser, workspace graph, route, dependency, config, and edge reports.
- [[canonical/cli-code-evidence-modes]]: CLI-facing code evidence command surface.

## Claim Boundary

- `typescript-ast` rows are structural evidence from the TypeScript compiler API and can support stronger code-backed claims when paired with source paths.
- `tree-sitter-*` rows are structural evidence from optional Tree-sitter grammars and can support stronger code-backed claims when paired with source paths.
- `python-light` and `go-light` rows are lightweight regex evidence. They are useful for routing and first-pass discovery, but high-confidence canonical claims should still verify the original source around the reported path and line.
- Inventory-only config and other recognized files prove file presence and selected configuration keys, not full semantic behavior.
- Workspace and CODEOWNERS rows are ownership/routing hints, not authorization policy or a complete GitHub CODEOWNERS semantic implementation.
- Canonical wiki pages should cite source paths or index output and remain reviewable markdown.
