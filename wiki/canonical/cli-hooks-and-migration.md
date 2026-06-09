---
status: active
updated: 2026-06-09
scope: project-canonical
read_budget: medium
decision_ref: wiki/meta/wiki-ops-v1-decisions.md
review_trigger: hook setup, startup context, git hook behavior, migration, or migration quality checks change
---

# CLI Hooks And Migration

## TL;DR

- Codex and Claude hooks inject compact wiki startup context.
- Hook setup is preservation-first and does not replace unrelated user hook settings.
- Migration preserves legacy docs as reviewable inbox candidates instead of copying them into canonical truth.

## Hook Behavior

Code-proven behavior:

- Codex uses `.codex/hooks.json` with `SessionStart` matcher `startup|resume|clear` and command `node .codex/hooks/wiki-session-start.js`; evidence: `upsertHookConfig` in `src/hooks.ts`.
- Claude Code uses `.claude/settings.json` with `SessionStart` matchers `startup`, `resume`, `clear`, and `compact`; evidence: `upsertClaudeHookConfig` in `src/hooks.ts`.
- Existing hook settings are preservation-first: bootstrap removes stale copies of its managed SessionStart command, then inserts the managed command into an existing matching SessionStart entry when present, preserving custom hooks, other hook events, and unrelated top-level settings; evidence: `upsertSessionStartHookConfig` in `src/hooks.ts` and smoke coverage in `tests/smoke.sh`.
- The generated hook script reads only `wiki/startup.md` and `wiki/index.md`, truncating each to configured character budgets before emitting additional context; evidence: `hookScript` in `src/hooks.ts`.
- Git hook setup configures `core.hooksPath` to `.githooks` only if the repository is git-backed and no hooks path already exists; `--no-git-config` skips this step; evidence: `upsertGitHooksPath` in `src/hooks.ts`.

## Migration Behavior

Code-proven behavior:

- `--migrate` / `--adopt-existing` moves an existing `wiki` to `wiki_legacy*`, recreates standard wiki structure, scans legacy markdown, and writes migration inboxes; evidence: `src/migration.ts`.
- `--review-migration` / `--semantic-migrate` syncs migration inbox statuses into migration review and verification pages; evidence: `src/migration.ts`.
- Migration classifies markdown as `decision`, `source`, `canonical`, or `other` using path and text heuristics; evidence: `classifyMarkdown` in `src/migration.ts`.
- Legacy files are not copied directly into new canonical pages. They are summarized into inbox tables for later human/agent rewrite; evidence: `buildInbox` and `runMigrationMode` in `src/migration.ts`.
- Migration review must rewrite useful legacy meaning instead of file-copying old markdown into `wiki/canonical/`, `wiki/decisions/`, or `wiki/sources`; evidence: `SKILL.md` and `wiki/AGENTS.md`.
- When `wiki_legacy*` exists, `--quality-check` reports `migration-copy-risk` as an error for new project wiki documents whose body matches or is highly token-similar to legacy markdown, while starter templates are exempt; evidence: `migrationCopyDiagnostics` in `src/modes.ts`.
- `--quality-check` reports `migration-filename-reuse` as a warning when a new project wiki document reuses a legacy basename/path and needs rewrite verification; evidence: `migrationCopyDiagnostics` in `src/modes.ts`.
