---
status: active
updated: 2026-06-10
scope: code-evidence
read_budget: medium
decision_ref: none
review_trigger: source module boundaries, CLI modes, generated-file ownership, or test coverage changes
---

# Code Map

## TL;DR

- `src/init-project-wiki.ts` is the CLI entrypoint and mode router.
- `src/templates.ts`, `src/hooks.ts`, `src/workspace.ts`, and `src/modes.ts` own most generated content, hook configuration, filesystem helpers, lifecycle modes, and wiki diagnostics.
- `src/code-index.ts` orchestrates the optional evidence subsystem that writes only under `.project-wiki/`; SQLite runtime loading, file indexing policy, and SQL safety checks are split into focused helpers.
- `src/migration.ts` maps existing markdown into review inboxes instead of copying old content directly into canonical truth.
- `benchmarks/project-metrics.js` is a maintainer release-evidence harness for token savings, read speed, lifecycle timing, code-index throughput, baselines, and Markdown summaries.
- `tests/smoke.sh` is the broad integration contract for bootstrap, lint, hooks, migration-adjacent modes, code evidence indexing, and skill installation.

## Entrypoint Flow

Evidence:

- `src/init-project-wiki.ts` parses mode flags from `src/args.ts`, rejects unknown commands/options, and exits early for single-purpose modes such as `install-skill`, code evidence modes, query, prune, review migration, and lint.
- When no early mode exits, `src/init-project-wiki.ts` creates wiki directories, hook directories, and `.githooks`, then writes or updates managed files.
- Bootstrap writes root instruction files through marker-bounded sections, writes generated hook scripts and config, and writes starter wiki files without replacing manual wiki pages that already have metadata.

Inference:

- The intended architecture is a small procedural CLI rather than a service or framework. Module boundaries are organized around generated artifact families and lifecycle modes.

## Module Responsibilities

| Module | Responsibility | Evidence |
| --- | --- | --- |
| `src/args.ts` | Command and flag parsing, known option validation, required option-value validation, and value extraction. | Exports pure `parseArgs(argv)`, mode booleans, `missingValueOptions`, and `argValue`/`argValues`. |
| `src/init-project-wiki.ts` | Top-level command routing and bootstrap orchestration. | Calls mode handlers first, then writes wiki, hook, and instruction files. |
| `src/templates.ts` | Managed markdown templates, metadata header builder, and starter wiki content. | Exports `metadata`, startup/index templates, wiki operating docs, glossary, and starter files. |
| `src/hooks.ts` | Codex/Claude/Cursor/Gemini session hook config, generated startup hook scripts, git hook scripts, wiki trailer scoping, and `core.hooksPath` setup. | Exports `upsertHookConfig`, `upsertClaudeHookConfig`, `upsertCursorHookConfig`, `upsertGeminiHookConfig`, `hookScript`, `cursorHookScript`, and git hook script strings. |
| `src/workspace.ts` | Repository-relative filesystem operations and idempotent writes. | Provides `writeManaged`, `writeStarter`, `upsertMarkedSection`, `deleteIfGenerated`, and git repository checks. |
| `src/modes.ts` | Query, issue-draft, lint, link-check, quality-check, doctor, refresh-index, inbox capture, and prune-check modes. | Implements lifecycle output, generated setup lint rules, wiki link diagnostics, document quality diagnostics, and problem/side-effect issue draft output. |
| `src/wiki-files.ts` | Markdown discovery, metadata extraction, wiki link conversion, link extraction, and table parsing helpers including escaped pipe support. | Used by lint, search, refresh index, diagnostics, and migration. |
| `src/migration.ts` | Existing wiki/docs migration into classified inboxes and verification summaries. | Renames `wiki` to `wiki_legacy*`, classifies markdown, and builds inbox/verification docs. |
| `src/code-index.ts` | Optional SQLite code evidence index orchestration. | Uses TypeScript AST extraction, `.project-wiki` output boundaries, parser backends, indexing commands, reports, and impact queries. |
| `src/code-index-db.ts` | SQLite runtime loading and database adapter types. | Requires Node 22.13+ because code evidence uses stable `node:sqlite` without experimental flags. |
| `src/code-index-file-policy.ts` | Code evidence file inclusion policy. | Defines ignored directories, recognized file languages, max indexed bytes, and sensitive config exclusions. |
| `src/code-index-sql.ts` | Read-only SQL guard for code evidence queries. | Rejects writes, pragmas, and multi-statement input before preparing user-provided SQL. |
| `src/install-skill.ts` | Copies package files into Codex, Claude, Cursor, and Gemini skill directories at user or project scope. | Copies `SKILL.md`, `dist`, localized READMEs, package metadata, license, and agents. |
| `benchmarks/project-metrics.js` | Maintainer benchmark for release evidence and baseline comparison. | Creates large wiki/code fixtures, runs the built CLI, emits benchmark JSON, and can save Markdown release summaries. |

## Verification Surface

Evidence:

- `package.json` defines `npm run build`, `npm run typecheck`, `npm test`, and `npm pack --dry-run`.
- `package.json` defines `npm run benchmark` and `npm run benchmark:baseline` for maintainer release-evidence metrics.
- `npm test` runs build, typecheck, Node unit tests, and `bash tests/smoke.sh`.
- `tests/unit/` covers pure argument parsing, code evidence mode detection, and SQL guard behavior without the full smoke harness.
- `tests/smoke.sh` creates temporary projects and verifies bootstrap idempotency, hook JSON, lint, link-check, quality-check, doctor, doctor safe-fix routing, glossary/index/inbox/search/issue-draft/prune modes, missing required option values, migration table escaping, git hook path behavior, code evidence indexing, sensitive config exclusion, stale detection, SQL safety, skill installation, and benchmark report shape.

## Generated Output Ownership

Evidence:

- `src/workspace.ts` preserves unmanaged root instruction content by updating only marker-bounded sections.
- `writeStarter` preserves existing wiki pages that already contain metadata headers.
- `src/hooks.ts` removes only prior managed hook commands matching the generated command before adding current matcher entries.
- `src/init-project-wiki.ts` removes old generated wiki-ops files from project canonical/decision locations if their generated sentinels match.

Inference:

- Future changes should keep generated operating content idempotent and preservation-first, because the smoke tests assert rerun behavior and custom hook preservation.
