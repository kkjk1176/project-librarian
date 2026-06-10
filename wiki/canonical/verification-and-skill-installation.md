---
status: active
updated: 2026-06-10
scope: project-canonical
read_budget: medium
decision_ref: wiki/decisions/npm-release-policy.md
review_trigger: build/test commands, smoke coverage, skill package contents, local runner precedence, or installed skill behavior changes
---

# Verification And Skill Installation

## TL;DR

- `npm test` is the broad verification command.
- Smoke coverage exercises bootstrap, hooks, diagnostics, migration safety, code evidence, parser modes, and install-skill behavior.
- Skill installation copies reusable package artifacts and does not bootstrap the target wiki.
- Installed skills prefer local `dist/init-project-wiki.js` runners before network package execution.

## Build And Test Commands

Code-proven behavior:

- `npm run build` runs `tsc` and makes `dist/init-project-wiki.js` executable.
- `npm run typecheck` runs `tsc --noEmit`.
- `npm run unit` runs Node unit tests under `tests/unit/` against the built `dist/` modules.
- `npm test` runs build, typecheck, unit tests, and `bash tests/smoke.sh`.
- `npm run benchmark` runs `node benchmarks/project-metrics.js` and is a maintainer release-evidence workflow, not a public end-user CLI mode.
- `npm run benchmark:baseline` saves versioned benchmark JSON and Markdown release evidence under `benchmarks/`.
- `npm pack --dry-run` is available through the `prepack` build hook; evidence: `package.json`.

## Smoke Test Coverage

Code-proven behavior:

- `tests/unit/args.test.js` covers pure command-line parsing behavior for default/init command selection, `install-skill`, unknown command/option reporting, missing value detection, boolean flag value rejection, code evidence aliases, and comma-separated code scopes.
- `tests/unit/code-index.test.js` covers code evidence mode detection, including `--code-impact`, and read-only SQL guard behavior.
- `tests/smoke.sh` covers help/unknown command failures, missing required option values, base bootstrap, rerun idempotency, lint, link-check, quality-check, doctor, hook output, glossary, refresh-index including scoped large-route generation, inbox capture, query, issue-draft output, prune-check, migration escaping, migration copy-risk detection, git hook behavior, preservation of custom instructions/hooks, code evidence index creation/query/report/section-report/impact report/parser-backend summary/workspace summary/workspace dependency graph/CODEOWNERS ownership hints/staleness/explicit incremental update/forced full rebuild/safety, TypeScript/JavaScript/Python/Go default extraction checks, Tree-sitter JS/TS/Python/Go/Rust/Java/PHP/Kotlin/Swift/C/C++/C# extraction checks, sensitive config exclusion, and skill install modes.
- Wiki diagnostics smoke coverage includes a broken wikilink failure, duplicate index route warning, quality warning, migration copy-risk error, and `--doctor --fix` adding a generated auto-discovered route.
- The smoke test uses temporary directories and removes them on exit; evidence: `tests/smoke.sh`.

## Skill Installation Contents

Code-proven behavior:

- `install-skill` copies `SKILL.md`, `dist`, localized READMEs, `LICENSE`, `package.json`, and `agents` into `.codex/skills/project-librarian`, `.claude/skills/project-librarian`, `.cursor/skills/project-librarian`, and/or `.gemini/skills/project-librarian`, depending on scope and agent options; evidence: `src/install-skill.ts`.
- `install-skill` reports that it only installs reusable skill files and does not create or update `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `wiki/`, `.cursor/rules/`, `.cursor/hooks.json`, `.codex/hooks.json`, or `.claude/settings.json`; evidence: `src/install-skill.ts` and `tests/smoke.sh`.
- Localized README Quick Start sections present `install-skill` first and project librarian/update/migration second; evidence: `README.md`, `README.ko.md`, `README.ja.md`, and `README.zh.md`.
- The skill execution contract resolves an installed local runner first: source repo `node dist/init-project-wiki.js`, project-scoped `.codex`, `.claude`, `.cursor`, or `.gemini` skill copies, then user-scoped skill copies; network `npx`/`npm exec` is only for environments where no local runner exists and registry access is acceptable; evidence: `SKILL.md`.
- If the resolved runner fails, agents must report or fix the real error instead of recreating generated output as a fallback; evidence: `SKILL.md`.
