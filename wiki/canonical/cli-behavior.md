---
status: active
updated: 2026-06-10
scope: project-canonical
read_budget: medium
decision_ref: none
review_trigger: CLI commands, generated files, lifecycle modes, hook behavior, or lint contract changes
---

# CLI Behavior

## TL;DR

- `project-librarian` creates or updates a repo-local `wiki/` plus Codex, Claude Code, Cursor, Gemini CLI, and git hook support.
- The CLI is intentionally idempotent and preservation-first for existing instructions and wiki pages.
- Operational modes are grouped into bootstrap/update, wiki diagnostics/routing, issue reporting, hooks/migration, skill installation, and optional code evidence surfaces.
- Unknown commands, unknown options, and known options missing required values fail before writing project files.
- Read detailed mode behavior on demand from the linked child pages below.

## Primary Bootstrap

Code-proven behavior:

- Running the default command creates `wiki/canonical`, `wiki/decisions`, `wiki/inbox`, `wiki/meta`, `wiki/sources`, `.codex/hooks`, `.claude/hooks`, `.cursor/rules`, and `.githooks`; evidence: `src/init-project-wiki.ts`.
- It writes or updates `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `wiki/AGENTS.md`, `.cursor/rules/project-librarian.mdc`, `.codex/hooks.json`, `.claude/settings.json`, session-start hook scripts, git hook scripts, `wiki/startup.md`, `wiki/index.md`, wiki meta pages, and starter canonical/decision/source pages; evidence: `src/init-project-wiki.ts`, `src/templates.ts`, `src/hooks.ts`.
- Existing `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, and `wiki/AGENTS.md` content is preserved outside managed marker sections; evidence: `upsertMarkedSection` in `src/workspace.ts`.
- Existing starter wiki files with metadata headers are treated as already owned by the project and are not overwritten; evidence: `writeStarter` in `src/workspace.ts`.

## Read On Demand

- [[canonical/cli-lifecycle-modes]]: lint, link-check, quality-check, doctor, query, refresh-index, inbox, prune, glossary, and skill install modes.
- [[canonical/cli-issue-reporting]]: issue-draft and issue-create contracts.
- [[canonical/cli-hooks-and-migration]]: Codex/Claude hook behavior, Cursor/Gemini instruction behavior, git hook behavior, and migration behavior.
- [[canonical/cli-code-evidence-modes]]: CLI-facing code evidence mode surface.

## Non-Goals And Boundaries

Code-proven behavior:

- Unknown commands and unknown options fail before bootstrap writes files; evidence: early checks in `src/init-project-wiki.ts` and smoke tests in `tests/smoke.sh`.
- Known value-taking options such as `--query`, `--code-query`, `--code-impact`, `--code-search-symbol`, `--code-report-section`, `--issue-title`, `--issue-body-file`, `--scope`, and `--agents` fail early when supplied without a value; evidence: `missingValueOptions` in `src/args.ts` and early checks in `src/init-project-wiki.ts`.
- Code index update and parser flags are scoped to `--code-index`: `--incremental` without `--code-index`, `--code-index-full` without `--code-index`, `--code-parser` without `--code-index`, or both update modes together fail before bootstrap writes files; evidence: `src/init-project-wiki.ts`.
- The CLI does not watch source code or wiki files. Index refresh, lint, migration review, and code evidence indexing are explicit commands; evidence: mode-driven entrypoint in `src/init-project-wiki.ts`.
