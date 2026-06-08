---
name: project-wiki-bootstrap
description: Bootstrap, update, migrate, or code-canonicalize a token-efficient project planning wiki. Use when the user asks to initialize, install, create, update, improve, migrate, adopt existing docs, analyze existing code into project wiki truth, or apply the reusable ./wiki + AGENTS.md + compact SessionStart hook setup for project planning, canonical docs, decision logs, startup summaries, or Karpathy-style LLM wiki workflow.
metadata:
  short-description: Bootstrap project planning wiki
---

# Project Wiki Bootstrap

Use this skill to install, update, validate, search, migrate, or code-canonicalize a token-efficient planning wiki in the current project.

Users should normally interact with this skill through natural language, or through `/project-wiki-bootstrap` in Claude Code. Do not ask users to run lifecycle flags directly unless they explicitly want shell commands; resolve a local project-wiki-bootstrap runner and execute the matching operation yourself from the project root.

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

1. Resolve the project-wiki-bootstrap runner before executing lifecycle operations.

Prefer an already installed local runner over network package execution:

- In the project-wiki-bootstrap source repository, use `node dist/init-project-wiki.js` when `dist/init-project-wiki.js` exists.
- In a target repository with a project-scoped Codex skill install, use `node .codex/skills/project-wiki-bootstrap/dist/init-project-wiki.js`.
- In a target repository with a project-scoped Claude skill install, use `node .claude/skills/project-wiki-bootstrap/dist/init-project-wiki.js`.
- In a user-scoped Codex skill install, use `node ~/.codex/skills/project-wiki-bootstrap/dist/init-project-wiki.js`.
- In a user-scoped Claude skill install, use `node ~/.claude/skills/project-wiki-bootstrap/dist/init-project-wiki.js`.

Use `npx` or `npm exec` only when no local runner exists and registry access is explicitly acceptable for the environment. When using npm package execution, pin the package version instead of running an unpinned public package.

If the resolved runner fails, report the real error and stop or fix the cause. Do not manually recreate bootstrap or migration output as a fallback.

2. For project bootstrap requests, choose the matching command and run it from the project root. The examples below use `$PROJECT_WIKI_BOOTSTRAP` to mean the resolved runner from step 1:

```bash
$PROJECT_WIKI_BOOTSTRAP
```

Use the command variants as follows:

- New project wiki or normal update: `$PROJECT_WIKI_BOOTSTRAP`.
- Existing wiki/docs need migration: `$PROJECT_WIKI_BOOTSTRAP --migrate`.
- Install hook files without changing git config: `$PROJECT_WIKI_BOOTSTRAP --no-git-config`.

When project terminology becomes important, initialize the optional glossary:

```bash
$PROJECT_WIKI_BOOTSTRAP --glossary-init
```

Map lifecycle requests to these internal operations:

- Validate/check the wiki: `$PROJECT_WIKI_BOOTSTRAP --lint`.
- Check wiki links and routing: `$PROJECT_WIKI_BOOTSTRAP --link-check`.
- Check document quality signals: `$PROJECT_WIKI_BOOTSTRAP --quality-check`.
- Run all wiki diagnostics: `$PROJECT_WIKI_BOOTSTRAP --doctor`.
- Safely refresh generated routing before diagnostics: `$PROJECT_WIKI_BOOTSTRAP --doctor --fix`.
- Search the wiki: `$PROJECT_WIKI_BOOTSTRAP --query "search terms"`.
- Refresh wiki routing/index: `$PROJECT_WIKI_BOOTSTRAP --refresh-index`.
- Capture a project candidate: `$PROJECT_WIKI_BOOTSTRAP --capture-inbox --title "Candidate title" --content "Candidate content"`.
- Check stale/pending pages: `$PROJECT_WIKI_BOOTSTRAP --prune-check`.
- Draft a GitHub issue body for a skill problem or side effect: `$PROJECT_WIKI_BOOTSTRAP --issue-draft --issue-title "Issue title"`.
- Review migrated inbox state: `$PROJECT_WIKI_BOOTSTRAP --review-migration`.

Skill problem reporting contract:

- If you discover a project-wiki-bootstrap bug, regression, confusing generated behavior, unintended side effect, or mismatch between this skill's promised workflow and the implementation while using this skill, run `$PROJECT_WIKI_BOOTSTRAP --issue-draft --issue-title "..."` before the final response unless the user explicitly asked not to generate a draft.
- Run the issue draft even when you can also fix the problem locally. The draft is read-only and preserves the problem report; it does not replace the code/wiki fix.
- Choose a concise issue title that names the observed problem, not the fix. Summarize the generated draft path or key output in the final response.

3. Verify:

```bash
node .codex/hooks/wiki-session-start.js
node .claude/hooks/wiki-session-start.js
$PROJECT_WIKI_BOOTSTRAP --lint
$PROJECT_WIKI_BOOTSTRAP --doctor
node -e 'JSON.parse(require("fs").readFileSync(".codex/hooks.json","utf8")); JSON.parse(require("fs").readFileSync(".claude/settings.json","utf8")); console.log("project wiki bootstrap ok")'
```

4. Report the files created or updated.

## Behavior

The script is idempotent. It creates missing files, updates the managed startup/hook/index operating files, and preserves project-specific planning files unless adding a missing TL;DR.

Existing root instruction files are preservation-first:

- Existing `AGENTS.md`, `CLAUDE.md`, and `wiki/AGENTS.md` files are not overwritten wholesale.
- If no managed project-wiki section exists, bootstrap appends its marker-bounded section to the existing file.
- On rerun, bootstrap replaces only content between its own `PROJECT-WIKI-*` markers and preserves surrounding project-specific content.

Use `--lint` for read-only validation:

```bash
$PROJECT_WIKI_BOOTSTRAP --lint
```

Use `--query`, `--prune-check`, `--issue-draft`, `--link-check`, `--quality-check`, and `--doctor` for read-only inspection/output through the resolved runner. Use `--doctor --fix` when safe generated routing refresh is intended. Use `--refresh-index`, `--capture-inbox`, `--glossary-init`, and `--migrate` only when updating wiki files is intended.

Use `--review-migration` or `--semantic-migrate` after migration inbox rows are processed. It syncs inbox statuses into `wiki/migration/review.md` and `wiki/migration/verification.md`.

## Code-Informed Canonicalization

Use this workflow when the user asks to analyze existing code and turn what the code proves into project wiki truth. This is a skill workflow, not a separate CLI flag.

For large repositories or repeated analysis, build a regenerable SQLite code evidence index before canonicalization:

```bash
$PROJECT_WIKI_BOOTSTRAP --code-index
```

`--code-evidence-index` is an equivalent explicit alias. Use the old `--code-index` form only as the short compatibility name.

Pass user-requested code scopes internally with `--code-scope`:

```bash
$PROJECT_WIKI_BOOTSTRAP --code-index --code-scope src --code-scope packages/api
```

Run read-only SQL over the cache with `--code-query`:

```bash
$PROJECT_WIKI_BOOTSTRAP --code-query "select path, language from files order by path"
```

Use the built-in inspection surfaces before writing custom SQL when they are enough:

```bash
$PROJECT_WIKI_BOOTSTRAP --code-status
$PROJECT_WIKI_BOOTSTRAP --code-files
$PROJECT_WIKI_BOOTSTRAP --code-search-symbol Auth
```

The code evidence index lives at `.project-wiki/code-evidence.sqlite`. It is not canonical wiki content, should not be copied into `wiki/`, and can be deleted and regenerated.

Treat the index as evidence support, not as a complete language-support guarantee. Strong extraction profiles can support code-proven claims; lightweight inventory and heuristic findings are pointers for follow-up reading.

Safety and runtime boundaries:

- Keep custom cache output under `.project-wiki/`; do not write disposable evidence databases into `wiki/` canonical content or elsewhere in the repository.
- Keep code scopes inside the project root.
- In git repositories, the indexer respects `.gitignore` through `git ls-files --cached --others --exclude-standard`.
- `.env*` files are excluded from the index, except `.env.example`.
- Obvious sensitive config filenames containing secret, credential, token, private, or key terms are excluded from the index.
- Code evidence indexing requires a Node runtime that provides `node:sqlite`; if unavailable, report the runtime requirement and continue with normal repository inspection.

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
   - Unclear, conflicting, or low-confidence interpretations belong in `wiki/inbox/` or `wiki/canonical/open-questions.md`, not directly in canonical truth.
4. Do not use fixed canonical filenames beyond existing starter docs. Choose or create files from topic boundaries, expected read frequency, and token budget.
5. Split large subjects into focused documents when a single file would force agents to read unrelated content.
6. Cite concrete evidence with repository-relative paths and distinguish code-proven facts from inference.
7. Update `wiki/startup.md` and `wiki/index.md` only with compact routing hints, not large code summaries.
8. Run `$PROJECT_WIKI_BOOTSTRAP --refresh-index` and `$PROJECT_WIKI_BOOTSTRAP --lint` after wiki edits when practical.

It installs:

- `AGENTS.md` compact project-wide wiki-first planning instructions.
- `CLAUDE.md` compact Claude Code compatibility file that imports `AGENTS.md`.
- `wiki/AGENTS.md` detailed wiki-internal editing and boundary rules.
- `.githooks/prepare-commit-msg` wiki commit trailer hook.
- `.githooks/wiki-commit-trailers.js` staged-file based trailer generator.
- `.codex/hooks.json` `SessionStart` hook.
- `.codex/hooks/wiki-session-start.js` compact startup context injector.
- `.claude/settings.json` Claude Code `SessionStart` hook.
- `.claude/hooks/wiki-session-start.js` compact startup context injector for Claude Code.
- `wiki/startup.md` compact session-start context.
- `wiki/index.md` router with read/update/token-budget hints.
- `wiki/canonical/` project-current-truth starter documents.
- Optional `wiki/canonical/glossary.md` project terminology contract when `--glossary-init` is used.
- `wiki/decisions/` project-decision starter documents and ADR templates.
- `wiki/meta/` wiki operating rules, project decision policy, and wiki-operations Decision Pack.
- `wiki/sources/` source summary starter documents.

The Codex and Claude Code startup hooks inject only `wiki/startup.md` and `wiki/index.md`. Codex uses `.codex/hooks.json` plus `.codex/hooks/wiki-session-start.js`; Claude Code uses `.claude/settings.json` plus `.claude/hooks/wiki-session-start.js`. `CLAUDE.md` still imports `AGENTS.md` so Claude Code shares the same compact wiki-first instruction contract without duplicating the rules. `AGENTS.md` should stay compact and project-wide; `wiki/AGENTS.md` should carry detailed wiki editing rules. `wiki/startup.md` should route detailed canonical and decision files as Read On Demand, not Always Read First, so detailed files are read only when the current question needs them.

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

The hook runs when staged files include `wiki/`, `AGENTS.md`, `CLAUDE.md`, `.codex/hooks.json`, `.codex/hooks/`, `.claude/settings.json`, `.claude/hooks/`, `.githooks/`, or `tools/project-wiki-bootstrap/`.

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

`--lint` verifies the Codex and Claude hook files/settings, git hook files, executable bits, trailer phrases, and `core.hooksPath` when the project is a git repository. If `--no-git-config` was used, an unset or different `core.hooksPath` is expected until the project owner configures it manually.

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

Migration mode is a reset-and-rewrite flow:

- If `./wiki` exists, renames it to `./wiki_legacy`.
- If `./wiki_legacy` already exists, preserves both by using a timestamped `wiki_legacy_...` directory for the current wiki.
- Creates a fresh `./wiki` using the current standard rules.
- Scans markdown files under the legacy wiki directory.
- Writes `wiki/migration/inventory.md`, `wiki/migration/plan.md`, and `wiki/migration/verification.md`.
- Writes rewrite inboxes:
  - `wiki/canonical/migration-inbox.md`
  - `wiki/decisions/migration-inbox.md`
  - `wiki/sources/migration-inbox.md`
- Adds migration routing to `wiki/startup.md` and `wiki/index.md`.

After migration mode, inspect inboxes and fold legacy content into canonical docs, Decision Packs, ADRs, source summaries, or meta docs.

Inbox rows use these statuses:

- `pending`: not processed yet.
- `adopted`: content was absorbed into the new wiki.
- `rejected`: content was intentionally not migrated.
- `resolved`: content was already covered or made obsolete by another migrated item.
- `needs-human-review`: LLM should not close this automatically because the item has important ambiguity, conflict, deletion risk, or product/API/security/policy/data-model impact.

Run semantic review sync after LLM or human processing:

```bash
$PROJECT_WIKI_BOOTSTRAP --review-migration
```

`wiki/migration/verification.md` verifies file coverage: every legacy markdown file should be mapped to a new-wiki migration target. This is not a semantic-completeness proof. Semantic migration is complete only after inbox rows are marked adopted/rejected/resolved and `needs-human-review` is 0.

Human review is not required for every inbox item. LLM may process ordinary rows and close them as adopted/rejected/resolved. Human review is reserved for `needs-human-review`.

Do not delete `wiki_legacy` until migration verification passes and semantic review is complete.
