---
name: project-librarian
description: Bootstrap, update, migrate, or code-canonicalize a token-efficient project planning wiki. Use when the user asks to initialize, install, create, update, improve, migrate, adopt existing docs, analyze existing code into project wiki truth, or apply the reusable ./wiki + AGENTS.md + compact SessionStart hook setup for project planning, canonical docs, decision logs, startup summaries, or Karpathy-style LLM wiki workflow.
metadata:
  short-description: Bootstrap project planning wiki
---

# Project Librarian

Use this skill to install, update, validate, search, migrate, or code-canonicalize a token-efficient planning wiki in the current project.

Users should normally interact with this skill through natural language, or through `/project-librarian` in Claude Code. Do not ask users to run lifecycle flags directly unless they explicitly want shell commands; resolve a local project-librarian runner and execute the matching operation yourself from the project root.

Supported actions:

- Bootstrap or update the project wiki and generated agent/hook files.
- Validate the wiki setup.
- Diagnose wiki links, duplicate routes, orphan pages, and document quality gaps.
- Search project wiki content.
- Refresh the wiki index.
- Capture a candidate note into the wiki inbox.
- Check for pending, stale, proposed, or undecided wiki pages.
- Draft a GitHub issue body for problems or side effects found while using the skill.
- Initialize a project glossary.
- Analyze existing code and canonicalize code-backed project behavior, features, policies, constraints, terminology, domain rules, and open questions into the wiki.
- Build and query an optional SQLite code evidence index for large repositories.
- Migrate an existing wiki/docs structure.
- Review processed migration inbox state.
- Install hook files without changing git config.

## Workflow

1. Resolve the project-librarian runner before executing lifecycle operations.

Prefer an already installed local runner over network package execution:

- In the project-librarian source repository, use `node dist/init-project-wiki.js` when `dist/init-project-wiki.js` exists.
- In a target repository with a project-scoped Codex skill install, use `node .codex/skills/project-librarian/dist/init-project-wiki.js`.
- In a target repository with a project-scoped Claude skill install, use `node .claude/skills/project-librarian/dist/init-project-wiki.js`.
- In a target repository with a project-scoped Cursor skill install, use `node .cursor/skills/project-librarian/dist/init-project-wiki.js`.
- In a target repository with a project-scoped Gemini skill install, use `node .gemini/skills/project-librarian/dist/init-project-wiki.js`.
- In a user-scoped Codex skill install, use `node ~/.codex/skills/project-librarian/dist/init-project-wiki.js`.
- In a user-scoped Claude skill install, use `node ~/.claude/skills/project-librarian/dist/init-project-wiki.js`.
- In a user-scoped Cursor skill install, use `node ~/.cursor/skills/project-librarian/dist/init-project-wiki.js`.
- In a user-scoped Gemini skill install, use `node ~/.gemini/skills/project-librarian/dist/init-project-wiki.js`.

Use `npx` or `npm exec` only when no local runner exists and registry access is explicitly acceptable for the environment. When using npm package execution, pin the package version instead of running an unpinned public package.

If the resolved runner fails, report the real error and stop or fix the cause. Do not manually recreate bootstrap or migration output as a fallback.

2. For project bootstrap requests, choose the matching command and run it from the project root. The examples below use `$PROJECT_LIBRARIAN` to mean the resolved runner from step 1:

```bash
$PROJECT_LIBRARIAN
```

Use the command variants as follows:

- New project wiki or normal update: `$PROJECT_LIBRARIAN`.
- Explicit existing-project update without migration: `$PROJECT_LIBRARIAN update` (rejects `--migrate` and `--adopt-existing`).
- Existing wiki/docs need migration: `$PROJECT_LIBRARIAN --migrate`.
- Install hook files without changing git config: `$PROJECT_LIBRARIAN --no-git-config`.

When project terminology becomes important, initialize the optional glossary:

```bash
$PROJECT_LIBRARIAN --glossary-init
```

Map lifecycle requests to these internal operations:

- Validate/check the wiki: `$PROJECT_LIBRARIAN --lint`.
- Check wiki links and routing: `$PROJECT_LIBRARIAN --link-check`.
- Check document quality signals: `$PROJECT_LIBRARIAN --quality-check`.
- Run all wiki diagnostics: `$PROJECT_LIBRARIAN --doctor`.
- Check migration-specific review signals: `$PROJECT_LIBRARIAN --migration-doctor`.
- Safely refresh generated routing before diagnostics: `$PROJECT_LIBRARIAN --doctor --fix`.
- Search the wiki: `$PROJECT_LIBRARIAN --query "search terms"`.
- Refresh wiki routing/index: `$PROJECT_LIBRARIAN --refresh-index`.
- Capture a project candidate: `$PROJECT_LIBRARIAN --capture-inbox --title "Candidate title" --content "Candidate content"`.
- Check stale/pending pages: `$PROJECT_LIBRARIAN --prune-check`.
- Draft a GitHub issue body for a skill problem or side effect: `$PROJECT_LIBRARIAN --issue-draft --issue-title "Issue title"`.
- After explicit user approval in a GitHub-backed repository, create the issue through GitHub CLI: `$PROJECT_LIBRARIAN --issue-create --issue-title "Issue title"`.
- Review migrated inbox state: `$PROJECT_LIBRARIAN --review-migration`.

Skill problem reporting contract:

- If you discover a project-librarian bug, regression, confusing generated behavior, unintended side effect, or mismatch between this skill's promised workflow and the implementation while using this skill, run `$PROJECT_LIBRARIAN --issue-draft --issue-title "..."` before the final response unless the user explicitly asked not to generate a draft.
- Run the issue draft even when you can also fix the problem locally. The draft is read-only and preserves the problem report; it does not replace the code/wiki fix.
- If the user explicitly approves filing a GitHub issue and the repository has GitHub CLI `gh` authenticated, run `$PROJECT_LIBRARIAN --issue-create --issue-title "..."` or use `gh issue create --title "..." --body-file <draft.md>`. If `gh`, authentication, the GitHub remote, or network access fails, report the real error and do not silently fall back.
- Choose a concise issue title that names the observed problem, not the fix. Summarize the generated draft path or key output in the final response.

3. Verify:

```bash
node .codex/hooks/wiki-session-start.js
node .claude/hooks/wiki-session-start.js
node .cursor/hooks/wiki-session-start.js
GEMINI_PROJECT_DIR="$PWD" node .gemini/hooks/wiki-session-start.js
$PROJECT_LIBRARIAN --lint
$PROJECT_LIBRARIAN --doctor
node -e 'const fs=require("fs"); JSON.parse(fs.readFileSync(".codex/hooks.json","utf8")); JSON.parse(fs.readFileSync(".claude/settings.json","utf8")); JSON.parse(fs.readFileSync(".cursor/hooks.json","utf8")); JSON.parse(fs.readFileSync(".gemini/settings.json","utf8")); if (!fs.readFileSync("GEMINI.md","utf8").includes("@AGENTS.md")) process.exit(1); if (!fs.readFileSync(".cursor/rules/project-librarian.mdc","utf8").includes("@AGENTS.md")) process.exit(1); console.log("project librarian ok")'
```

4. Report the files created or updated.

## Behavior

The script is idempotent. It creates missing files, updates the managed startup/hook/index operating files, and preserves project-specific planning files unless adding a missing TL;DR.

Existing root instruction files are preservation-first:

- Existing `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, and `wiki/AGENTS.md` files are not overwritten wholesale.
- If no managed project-wiki section exists, bootstrap appends its marker-bounded section to the existing file.
- On rerun, bootstrap replaces only content between its own `PROJECT-WIKI-*` markers and preserves surrounding project-specific content.

Use `--lint` for read-only validation:

```bash
$PROJECT_LIBRARIAN --lint
```

Use `--query`, `--prune-check`, `--issue-draft`, `--link-check`, `--quality-check`, `--doctor`, `--migration-lint`, `--migration-quality-check`, and `--migration-doctor` for read-only inspection/output through the resolved runner. Use `--doctor --fix` when safe generated routing refresh is intended. Use `--refresh-index`, `--capture-inbox`, `--glossary-init`, and `--migrate` only when updating wiki files is intended.

Use `--review-migration` or `--semantic-migrate` after migration coverage or compatible inbox rows are processed. It syncs unit coverage and safe file-level inbox statuses into `wiki/migration/review.md` and `wiki/migration/verification.md`.

## Code-Informed Canonicalization

Use this workflow when the user asks to analyze existing code and turn what the code proves into project wiki truth. This is a skill workflow, not a separate CLI flag.

For large repositories or repeated analysis, build a regenerable SQLite code evidence index before canonicalization:

```bash
$PROJECT_LIBRARIAN --code-index
```

`--code-evidence-index` is an equivalent explicit alias. Use the old `--code-index` form only as the short compatibility name.

Pass user-requested code scopes internally with `--code-scope`:

```bash
$PROJECT_LIBRARIAN --code-index --code-scope src --code-scope packages/api
```

Use the optional Tree-sitter backend only when stronger multi-language structural extraction is intended and optional packages are installed:

```bash
$PROJECT_LIBRARIAN --code-index --code-parser tree-sitter --code-scope src
```

Require a compatible existing cache for changed-file-only updates with `--incremental`:

```bash
$PROJECT_LIBRARIAN --code-index --incremental --code-scope src
```

Run read-only SQL over the cache with `--code-query`:

```bash
$PROJECT_LIBRARIAN --code-query "select path, language from files order by path"
```

Use the built-in inspection surfaces before writing custom SQL when they are enough:

```bash
$PROJECT_LIBRARIAN --code-status
$PROJECT_LIBRARIAN --code-files
$PROJECT_LIBRARIAN --code-report --code-report-section parsers
$PROJECT_LIBRARIAN --code-report --code-report-section workspaces
$PROJECT_LIBRARIAN --code-report --code-report-section workspace-graph
$PROJECT_LIBRARIAN --code-report --code-report-section routes
$PROJECT_LIBRARIAN --code-impact Auth
$PROJECT_LIBRARIAN --code-search-symbol Auth
```

The code evidence index lives at `.project-wiki/code-evidence.sqlite`. It is not canonical wiki content, should not be copied into `wiki/`, and can be deleted and regenerated.

Treat the index as evidence support, not as a complete language-support guarantee. Strong extraction profiles can support code-proven claims; lightweight inventory and heuristic findings are pointers for follow-up reading.

Safety and runtime boundaries:

- Keep custom cache output under `.project-wiki/`; do not write disposable evidence databases into `wiki/` canonical content or elsewhere in the repository.
- Keep code scopes inside the project root.
- In git repositories, the indexer respects `.gitignore` through `git ls-files --cached --others --exclude-standard`.
- `.env*` files are excluded from the index, except `.env.example`.
- Obvious sensitive config filenames containing secret, credential, token, private, or key terms are excluded from the index.
- Project Librarian requires Node 22.13+ for the installed runner because code evidence indexing uses stable `node:sqlite` without experimental flags; if the runtime is older, report the real runtime error instead of recreating output manually.
- `--code-parser tree-sitter` requires the optional `@sengac/tree-sitter*` package family for JS/TS/TSX/Python/Go/Rust/Java/PHP/Kotlin/Swift/C/C++/C# extraction; if unavailable, report the package error instead of silently using the default backend.

Scope selection is handled through the user's natural-language request:

- Whole repository if the user asks for all code or gives no narrower scope.
- One or more explicit directories, packages, apps, services, or files when the user names them.
- Exclude generated files, vendored files, lockfiles, build output, and tests unless they are needed to understand behavior, contracts, or risk.

Execution contract:

1. Bootstrap the wiki first if the project wiki is missing.
2. Inspect the requested code scope using normal repository-reading tools.
3. Separate evidence mapping from canonical truth:
   - Code structure, entrypoints, module relationships, execution flows, read-on-demand routes, and evidence paths belong under `wiki/meta/` with descriptive project-specific filenames chosen by the LLM.
   - Code-backed current project behavior, features, policies, constraints, terminology, domain rules, and operational facts belong under `wiki/canonical/`.
   - Important design rationale or tradeoffs inferred from code may belong under `wiki/decisions/` when they meet the decision policy.
   - Unclear, conflicting, or low-confidence interpretations belong in `wiki/inbox/` or a focused canonical questions page created for the topic, not directly in canonical truth.
4. Do not use fixed canonical filenames. Choose or create files from topic boundaries, expected read frequency, and token budget.
5. Split large subjects into focused documents when a single file would force agents to read unrelated content.
6. Cite concrete evidence with repository-relative paths and distinguish code-proven facts from inference.
7. Update `wiki/startup.md` and `wiki/index.md` only with compact routing hints, not large code summaries.
8. Run `$PROJECT_LIBRARIAN --refresh-index` and `$PROJECT_LIBRARIAN --lint` after wiki edits when practical.

It installs:

- `AGENTS.md` compact project-wide wiki-first planning instructions.
- `CLAUDE.md` compact Claude Code compatibility file that imports `AGENTS.md`.
- `GEMINI.md` compact Gemini CLI compatibility file that imports `AGENTS.md`.
- `wiki/AGENTS.md` detailed wiki-internal editing and boundary rules.
- `.cursor/rules/project-librarian.mdc` compact always-applied Cursor rule that references `AGENTS.md`.
- `.githooks/prepare-commit-msg` wiki commit trailer hook.
- `.githooks/wiki-commit-trailers.js` staged-file based trailer generator.
- `.codex/hooks.json` `SessionStart` hook.
- `.codex/hooks/wiki-session-start.js` compact startup context injector.
- `.claude/settings.json` Claude Code `SessionStart` hook.
- `.claude/hooks/wiki-session-start.js` compact startup context injector for Claude Code.
- `.cursor/hooks.json` Cursor `sessionStart` hook.
- `.cursor/hooks/wiki-session-start.js` compact startup context injector for Cursor.
- `.gemini/settings.json` Gemini CLI `SessionStart` hook.
- `.gemini/hooks/wiki-session-start.js` compact startup context injector for Gemini CLI.
- `wiki/startup.md` compact session-start context.
- `wiki/index.md` router with read/update/token-budget hints.
- `wiki/canonical/` directory for project-current-truth documents, created only when real content exists.
- Optional `wiki/canonical/glossary.md` project terminology contract when `--glossary-init` is used.
- `wiki/decisions/` project-decision directory and lightweight decision ledgers.
- `wiki/meta/` wiki operating rules, project decision policy, and wiki-operations Decision Pack.
- `wiki/sources/` source summary documents.

The Codex, Claude Code, Cursor, and Gemini CLI startup hooks inject only `wiki/startup.md` and `wiki/index.md`. Codex uses `.codex/hooks.json` plus `.codex/hooks/wiki-session-start.js`; Claude Code uses `.claude/settings.json` plus `.claude/hooks/wiki-session-start.js`; Cursor uses `.cursor/hooks.json` plus `.cursor/hooks/wiki-session-start.js`; Gemini CLI uses `.gemini/settings.json` plus `.gemini/hooks/wiki-session-start.js`. `CLAUDE.md` and `GEMINI.md` import `AGENTS.md`, and `.cursor/rules/project-librarian.mdc` references `AGENTS.md`, so Claude Code, Gemini CLI, and Cursor share the same compact wiki-first instruction contract without duplicating the rules. `AGENTS.md` should stay compact and project-wide; `wiki/AGENTS.md` should carry detailed wiki editing rules. `wiki/startup.md` should route detailed canonical and decision files as Read On Demand, not Always Read First, so detailed files are read only when the current question needs them.

When the project is a git repository, the script configures `git config core.hooksPath .githooks` by default only when `core.hooksPath` is unset, so wiki commit trailers are generated automatically without replacing an existing hook chain. Use `--no-git-config` to install hook files without changing git config. If the project is not a git repository yet, the hook files are still installed and will work after `core.hooksPath` is set.

## Language Policy

The public repository README is English by default and may link to localized documentation such as `README.ko.md`.

Generated operating documents are English by default, including root `AGENTS.md`, `wiki/AGENTS.md`, `wiki/startup.md`, `wiki/index.md`, migration operating pages, and wiki meta pages.

Project canonical wiki content should not default to Korean or English. Choose the language from explicit user instruction, existing project language, source documents, and team context. When no signal exists, prefer the language already used in the current interaction or repository.

## Boundary Rule

`wiki/canonical/` and `wiki/decisions/` are for project planning only. Do not store wiki operating decisions, hook/bootstrap/lint/migration details, LLM collaboration preferences, assistant reminders, or non-project workflow memory there.

Use:

- `wiki/meta/` for the wiki operating contract and wiki-operations decisions.
- Root `AGENTS.md`, hooks, or skills for durable project-wide LLM instructions and collaboration memory.
- `wiki/AGENTS.md` for wiki-internal editing rules that should apply only under `wiki/`.
- `wiki/canonical/` only for current project truth.
- `wiki/decisions/` only for project decision history.

Every wiki markdown file should include a compact metadata header with `status`, `updated`, `scope`, `read_budget`, `decision_ref`, and `review_trigger`.

## Commit Automation

Wiki-specific commit trailers are automated through `.githooks/prepare-commit-msg`.

The hook runs when staged files include `wiki/`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.cursor/rules/`, `.cursor/hooks.json`, `.cursor/hooks/`, `.gemini/settings.json`, `.gemini/hooks/`, `.codex/hooks.json`, `.codex/hooks/`, `.claude/settings.json`, `.claude/hooks/`, `.githooks/`, or `tools/project-librarian/`.

It appends these trailers when they are missing:

- `Wiki-scope`
- `Canonical-updated`
- `Decision-ref`
- `Startup-updated`
- `Index-updated`
- `Migration-status`
- `Tested`
- `Not-tested`

Do not hand-write wiki trailers unless the hook is unavailable or the generated value needs correction.

`--lint` verifies common wiki files plus the agent surfaces that are present in the project. If any file for a surface exists, lint requires the rest of that surface's files and settings; uninstalled Cursor or Gemini surfaces are not hard requirements. It also checks git hook files, executable bits, trailer phrases, and `core.hooksPath` when the project is a git repository. If `--no-git-config` was used, an unset or different `core.hooksPath` is expected until the project owner configures it manually.

## Glossary Mode

`--glossary-init` creates `wiki/canonical/glossary.md` only when terminology has become useful. It also adds glossary routing to `wiki/index.md` without adding glossary content to startup hook context.

Use glossary mode when:

- The same concept has two or more name candidates.
- Domain or business terms repeat.
- Roles, states, permissions, events, entities, API names, DB names, or UI labels appear.
- A term needs a canonical name before it enters API, DB, UI, or policy text.

The glossary is a project terminology contract, not a general notes file. It excludes wiki operating terms and LLM collaboration memory.

`--lint` validates glossary metadata/table shape when the glossary exists, and warns when canonical docs show naming/model signals but no glossary exists.

## Lifecycle Modes

These modes preserve this project's stricter source-of-truth boundaries:

- `--query "terms"`: read-only keyword search over wiki paths, metadata, titles, and bodies. It does not use embeddings.
- `--issue-draft --issue-title "..."`: read-only Markdown problem-report draft for skill failures, side effects, confusing behavior, or generated-file surprises. It does not create a GitHub issue or require network access.
- `--refresh-index`: updates a managed auto-discovered block in `wiki/index.md` for wiki files not routed by the hand-written index.
- `--capture-inbox --title "..." --content "..."`: appends a project-candidate row to `wiki/inbox/project-candidates.md` and routes the inbox from `wiki/index.md`.
- `--prune-check`: read-only report of active wiki pages with pending/proposed/stale review signals.

Captured inbox entries are not canonical. Fold them into `wiki/canonical/`, `wiki/decisions/`, `wiki/sources/`, or `wiki/meta/` only after review.

## Migration Mode

`--migrate` and `--adopt-existing` are aliases.

Migration mode is a reset-and-restructure flow:

- If `./wiki` exists, renames it to `./wiki_legacy`.
- If `./wiki_legacy` already exists, preserves both by using a timestamped `wiki_legacy_...` directory for the current wiki.
- Creates a fresh `./wiki` using the current standard rules.
- Scans markdown files under the legacy wiki directory.
- Skips form-only/template legacy files as non-semantic input; `inventory.md` records the skipped source and reason instead of creating review rows or new wiki pages.
- Writes `wiki/migration/inventory.md`, `wiki/migration/unit-map.md`, `wiki/migration/split-plan.md`, `wiki/migration/coverage.md`, `wiki/migration/plan.md`, `wiki/migration/review.md`, and `wiki/migration/verification.md`.
- Writes rewrite inboxes:
  - `wiki/canonical/migration-inbox.md`
  - `wiki/decisions/migration-inbox.md`
  - `wiki/sources/migration-inbox.md`
- Adds migration routing to `wiki/startup.md` and `wiki/index.md`.

After migration mode, inspect inboxes and fold legacy content into canonical docs, Decision Packs, ADRs, source summaries, or meta docs. Minimize information loss while converting useful legacy meaning to the current wiki structure and rules. Legacy files, sections, blocks, and wording may be retained when review confirms each retained unit belongs in the new topic shape and remains current project truth. Do not link to or cite `wiki_legacy*` from the new wiki; cite current-project evidence when possible, and keep ambiguous material in the migration inbox or mark it `needs-human-review`.

`wiki/migration/coverage.md` is the unit-level coverage ledger. It accounts for extracted legacy headings, paragraphs, list items, table rows, and code blocks with stable unit IDs. Form-only/template files are excluded before unit extraction and are listed in `inventory.md` instead. Every extracted unit should end as `adopted`, `merged`, `superseded`, `rejected`, `resolved`, or `needs-human-review`; `pending` means the unit is still open. `adopted` and `merged` rows require a new-wiki target under `wiki/canonical/`, `wiki/decisions/`, `wiki/sources/`, or `wiki/meta/`. Deleting an extracted unit row is treated as possible information loss and `--migration-lint` reports it as `migration-unaccounted-unit`.

`wiki/migration/unit-map.md` is the generated per-unit classification ledger. `wiki/migration/split-plan.md` groups units by suggested new target file. `--migration-lint` validates these files alongside `coverage.md`: stale or duplicate units, invalid storage/confidence/status values, split count drift, target drift, and old coverage schemas are reported separately from normal lint.

When one legacy file maps to multiple target pages, file-level migration inbox status is not enough to close every unit. In that case, update `wiki/migration/coverage.md` unit rows directly; `--review-migration` records that the file-level inbox row was ignored for the mixed-target source. File-level inbox fallback remains available only when all units from the legacy source point to the same target, preserving older migration workflows without masking mixed-page splits.

Inbox rows use these statuses:

- `pending`: not processed yet.
- `adopted`: content was absorbed into the new wiki.
- `rejected`: content was intentionally not migrated.
- `resolved`: content was already covered or made obsolete by another migrated item.
- `needs-human-review`: LLM should not close this automatically because the item has important ambiguity, conflict, deletion risk, or product/API/security/policy/data-model impact.

Run semantic review sync after LLM or human processing:

```bash
$PROJECT_LIBRARIAN --review-migration
```

`wiki/migration/verification.md` verifies current-batch unit coverage: every extracted legacy meaning unit should be mapped to a new-wiki target and remain accounted for. Semantic migration is complete only after unit coverage or safe inbox rows are marked adopted/rejected/resolved and `needs-human-review` is 0.

Human review is not required for every inbox item. LLM may process ordinary rows and close them as adopted/rejected/resolved. Human review is reserved for `needs-human-review`.

Run `$PROJECT_LIBRARIAN --migration-doctor` after migration review. Normal `--quality-check` and `--doctor` intentionally omit migration-only policy/structure signals so accepted migration decisions do not pollute later non-migration document checks. `--migration-quality-check` and `--migration-doctor` report `migration-legacy-reference` as an error when active project truth links to or cites `wiki_legacy*`. They do not warn merely because a new wiki document copies legacy wording, blocks, whole documents, or filenames; those are acceptable when the result follows the current wiki policy and structure. Use `--migration-lint` and `wiki/migration/coverage.md` to prevent information loss.

Do not delete `wiki_legacy` until migration verification passes, semantic review is complete, and migration policy/structure diagnostics are clear.
