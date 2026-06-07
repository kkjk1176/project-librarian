---
name: project-wiki-bootstrap
description: Bootstrap, update, or migrate a token-efficient project planning wiki. Use when the user asks to initialize, install, create, update, improve, migrate, adopt existing docs, or apply the reusable ./wiki + AGENTS.md + compact SessionStart hook setup for project planning, canonical docs, decision logs, startup summaries, or Karpathy-style LLM wiki workflow.
metadata:
  short-description: Bootstrap project planning wiki
---

# Project Wiki Bootstrap

Use this skill to install, update, validate, search, or migrate a token-efficient planning wiki in the current project.

Users should normally interact with this skill through natural language, or through `/project-wiki-bootstrap` in Claude Code. Do not ask users to run lifecycle flags directly unless they explicitly want shell commands; execute the matching `npx project-wiki-bootstrap` operation yourself from the project root.

Supported actions:

- Bootstrap or update the project wiki and generated agent/hook files.
- Validate the wiki setup.
- Search project wiki content.
- Refresh the wiki index.
- Capture a candidate note into the wiki inbox.
- Check for pending, stale, proposed, or undecided wiki pages.
- Initialize a project glossary.
- Migrate an existing wiki/docs structure.
- Review processed migration inbox state.
- Install hook files without changing git config.

## Workflow

1. For initial wiki bootstrap or general update requests, run from the project root:

```bash
npx project-wiki-bootstrap
```

For projects that already have wiki/docs in another structure, run migration mode:

```bash
npx project-wiki-bootstrap --migrate
```

When project terminology becomes important, initialize the optional glossary:

```bash
npx project-wiki-bootstrap --glossary-init
```

Map lifecycle requests to these internal operations:

- Validate/check the wiki: `npx project-wiki-bootstrap --lint`.
- Search the wiki: `npx project-wiki-bootstrap --query "search terms"`.
- Refresh wiki routing/index: `npx project-wiki-bootstrap --refresh-index`.
- Capture a project candidate: `npx project-wiki-bootstrap --capture-inbox --title "Candidate title" --content "Candidate content"`.
- Check stale/pending pages: `npx project-wiki-bootstrap --prune-check`.
- Review migrated inbox state: `npx project-wiki-bootstrap --review-migration`.
- Install hook files without changing git config: `npx project-wiki-bootstrap --no-git-config`.

2. Verify:

```bash
node .codex/hooks/wiki-session-start.js
node .claude/hooks/wiki-session-start.js
npx project-wiki-bootstrap --lint
node -e 'JSON.parse(require("fs").readFileSync(".codex/hooks.json","utf8")); JSON.parse(require("fs").readFileSync(".claude/settings.json","utf8")); console.log("project wiki bootstrap ok")'
```

3. Report the files created or updated.

## Behavior

The script is idempotent. It creates missing files, updates the managed startup/hook/index operating files, and preserves project-specific planning files unless adding a missing TL;DR.

Existing root instruction files are preservation-first:

- Existing `AGENTS.md`, `CLAUDE.md`, and `wiki/AGENTS.md` files are not overwritten wholesale.
- If no managed project-wiki section exists, bootstrap appends its marker-bounded section to the existing file.
- On rerun, bootstrap replaces only content between its own `PROJECT-WIKI-*` markers and preserves surrounding project-specific content.

Use `--lint` for read-only validation:

```bash
npx project-wiki-bootstrap --lint
```

Use `--query` and `--prune-check` for read-only inspection. Use `--refresh-index`, `--capture-inbox`, `--glossary-init`, and `--migrate` only when updating wiki files is intended.

Use `--review-migration` or `--semantic-migrate` after migration inbox rows are processed. It syncs inbox statuses into `wiki/migration/review.md` and `wiki/migration/verification.md`.

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

When the project is a git repository, the script configures `git config core.hooksPath .githooks` by default so wiki commit trailers are generated automatically. Use `--no-git-config` to install hook files without changing git config. If the project is not a git repository yet, the hook files are still installed and will work after `core.hooksPath` is set.

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
npx project-wiki-bootstrap --review-migration
```

`wiki/migration/verification.md` verifies file coverage: every legacy markdown file should be mapped to a new-wiki migration target. This is not a semantic-completeness proof. Semantic migration is complete only after inbox rows are marked adopted/rejected/resolved and `needs-human-review` is 0.

Human review is not required for every inbox item. LLM may process ordinary rows and close them as adopted/rejected/resolved. Human review is reserved for `needs-human-review`.

Do not delete `wiki_legacy` until migration verification passes and semantic review is complete.
