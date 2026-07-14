# Usage

Use this guide after the README quick start. It covers install scope, runner paths, generated files, migration behavior, and agent-facing requests.

## Install Scopes

Use `npx` for initial skill installation or for an explicit registry-version project update:

```bash
npx project-librarian@latest install --scope user --agents all
```

Install into the current repository instead:

```bash
npx project-librarian@latest install --scope project --agents all
```

`install` copies reusable skill files and required local-runner runtime dependencies. It does not create or update `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `wiki/`, `.cursor/rules/`, `.cursor/hooks.json`, `.gemini/settings.json`, `.codex/hooks.json`, or `.claude/settings.json`. `install-skill` remains supported as a compatibility alias.

| Situation | Command |
| --- | --- |
| Install globally for all supported agents | `npx project-librarian@latest install --scope user --agents all` |
| Install in the current repository | `npx project-librarian@latest install --scope project --agents all` |
| Install only Codex | `npx project-librarian@latest install --agents codex` |
| Install only Claude Code | `npx project-librarian@latest install --agents claude` |
| Install only Cursor | `npx project-librarian@latest install --agents cursor` |
| Install only Gemini CLI | `npx project-librarian@latest install --agents gemini` |
| Preview install output | `npx project-librarian@latest install --scope project --agents all --dry-run` |

`--agents` accepts comma-separated values such as `codex,claude,cursor,gemini`. `all` targets every supported agent. `--scope` accepts `user` or `project`.

The project setup/update runner also accepts `--agents`. Fresh setup defaults to all supported agent surfaces only when no project-scoped Project Librarian skill install is present. If the repository already has project-scoped skills such as `.codex/skills/project-librarian/` and `.claude/skills/project-librarian/`, the first setup uses that installed agent set by default. Existing non-migration updates preserve Project Librarian-managed surfaces. If no managed surface exists yet, update selects only agent roots already present, so a bare `.codex/` repository gains the Codex setup without gaining Claude, Cursor, or Gemini files. An update with no detectable install or agent root exits before writing; use `init` for a fresh project or pass `--agents`. Use `project-librarian update --agents cursor` or `project-librarian update --agents all` when you intentionally want to add newly supported surfaces; unlisted surfaces are not deleted.

`project-librarian update` also syncs any project-scoped Project Librarian skill installs that already exist for the selected surfaces from the currently running package, including the runtime dependencies needed by the project-local runner. An existing shared `.agents/skills/project-librarian/` install is synchronized independently and does not imply Codex, Claude, Cursor, or Gemini setup surfaces. This means `npx project-librarian@latest update` can refresh the repository's managed setup, hooks, wiki meta files, and existing project-scoped skill copies without migration. It does not create new project-scoped skill installs by default and does not update user-scoped skill installs; use `install --scope user` for that.

## Runner Paths

These paths are mainly for agents and automation. After installation, agents should run the installed local copy with `node`, not `npx`. This avoids network access and unpinned package execution in restricted agent environments.

| Installation | Runner |
| --- | --- |
| Shared project-scoped skill | `node .agents/skills/project-librarian/dist/init-project-wiki.js` |
| Project-scoped Codex skill | `node .codex/skills/project-librarian/dist/init-project-wiki.js` |
| Project-scoped Claude skill | `node .claude/skills/project-librarian/dist/init-project-wiki.js` |
| Project-scoped Cursor skill | `node .cursor/skills/project-librarian/dist/init-project-wiki.js` |
| Project-scoped Gemini skill | `node .gemini/skills/project-librarian/dist/init-project-wiki.js` |
| User-scoped Codex skill | `node ~/.codex/skills/project-librarian/dist/init-project-wiki.js` |
| User-scoped Claude skill | `node ~/.claude/skills/project-librarian/dist/init-project-wiki.js` |
| User-scoped Cursor skill | `node ~/.cursor/skills/project-librarian/dist/init-project-wiki.js` |
| User-scoped Gemini skill | `node ~/.gemini/skills/project-librarian/dist/init-project-wiki.js` |

## Common Agent Requests

Ask your agent for the outcome you want; the skill maps the request to the local runner internally.

Wiki setup and maintenance:

| Goal | Ask The Agent | Internal Action |
| --- | --- | --- |
| Create or update the wiki | "Use Project Librarian to set up or update this repository's planning wiki." | `[init]` |
| Update existing setup without migration | "Update this repository's Project Librarian setup without migrating the wiki." | `update` |
| Update from the npm latest package without migration | "Run the latest Project Librarian update for this repository without migrating the wiki." | `npx project-librarian@latest update` |
| Add a specific agent surface to an existing setup | "Add the Cursor Project Librarian surface without migrating the wiki." | `update --agents cursor` |
| Migrate existing docs/wiki content | "Use Project Librarian to migrate the existing docs/wiki content." | `--migrate` |
| Validate generated setup | "Run Project Librarian validation." | `--lint` |
| Check links and document quality | "Run Project Librarian diagnostics." | `--doctor` |
| Refresh generated routing before diagnostics | "Refresh Project Librarian routing and then run diagnostics." | `--doctor --fix` |
| Search project wiki content | "Search the Project Librarian wiki for authentication decisions." | `--query "authentication decisions"` |
| Show backlinks and decision citations for a page | "Show Project Librarian wiki impact for decisions/release-policy." | `--wiki-impact "decisions/release-policy"` |
| Find nearby wiki context | "Show Project Librarian wiki neighborhood for canonical/project-brief." | `--wiki-neighborhood "canonical/project-brief"` |
| Capture a candidate note | "Capture this as a Project Librarian candidate note: <details>." | `--capture-inbox --title "Candidate" --content "Details"` |
| Save a session handoff | "Save a Project Librarian session handoff for the current work." | `--handoff-save --goal "..." --state "..." --next "..."` |
| Resume from a handoff | "Show the last Project Librarian session handoff." | `--handoff-show` |
| Promote handoff candidates | "Promote the last Project Librarian handoff to the wiki inbox." | `--handoff-promote-inbox` |
| Opt in to full handoff injection | "Enable the Project Librarian full handoff injection experiment." | `--handoff-injection-enable` |
| Report stale or unresolved wiki pages | "Check Project Librarian for stale or unresolved pages." | `--prune-check` |
| Report only higher-signal stale or unresolved wiki pages | "Check Project Librarian for strict stale or unresolved pages." | `--prune-check --prune-check-strict` |
| Install hook files without changing git config | "Set up Project Librarian hook files without changing git config." | `--no-git-config` |

Code evidence:

| Goal | Ask The Agent | Internal Action |
| --- | --- | --- |
| Build the default evidence cache | "Build Project Librarian code evidence for `src`." | `--code-index --code-scope src` |
| Build multiple scopes | "Build Project Librarian code evidence for `src` and `packages/api`." | `--code-index --code-scope src --code-scope packages/api` |
| Require incremental update | "Update the Project Librarian code evidence index incrementally." | `--code-index --incremental` |
| Force a full rebuild | "Fully rebuild the Project Librarian code evidence index." | `--code-index --code-index-full` |
| Approve a schema migration | "Migrate the Project Librarian code evidence index schema." | `--code-index --code-index-migrate` |
| Use optional Tree-sitter backend | "Build Project Librarian code evidence with the Tree-sitter parser." | `--code-index --code-parser tree-sitter` |
| Inspect cache compatibility | "Inspect Project Librarian code evidence cache health." | `--code-index-health` |
| Show cache status | "Show Project Librarian code evidence status." | `--code-status` |
| List indexed files | "List files in the Project Librarian code evidence index." | `--code-files` |
| Print architecture and ownership report | "Show the Project Librarian code report." | `--code-report` |
| Print one report section | "Show the routes section of the Project Librarian code report." | `--code-report --code-report-section routes` |
| Inspect impact evidence | "Show Project Librarian impact evidence for `healthHandler`." | `--code-impact healthHandler` |
| Build a context pack | "Build a Project Librarian context pack for `healthHandler`." | `--code-context-pack healthHandler` |
| Search indexed symbols | "Search Project Librarian code evidence for symbol `Auth`." | `--code-search-symbol Auth` |
| Run conservative read-only SQL | "Run a read-only Project Librarian code evidence query for file paths." | `--code-query "select path from files order by path"` |

Only one code evidence mode can run at a time. `--incremental`, `--code-index-full`, `--code-index-migrate`, and `--code-parser` are valid only with `--code-index`. `--code-index-migrate` is explicit approval to replace an existing disposable index when its schema version differs from the current package.

## What Gets Installed

Fresh setup installs the supported agent surfaces below unless you pass `--agents` or the repository already has project-scoped Project Librarian skills for a narrower agent set. Existing non-migration updates preserve the detected surface set by default and update only those selected surfaces plus the common wiki/git-hook files.

Project instruction files:

- `AGENTS.md`
- `CLAUDE.md`
- `GEMINI.md`
- `wiki/AGENTS.md`
- `.cursor/rules/project-librarian.mdc`

Startup hooks:

- `.codex/hooks.json`
- `.codex/hooks/wiki-session-start.js`
- `.claude/settings.json`
- `.claude/hooks/wiki-session-start.js`
- `.cursor/hooks.json`
- `.cursor/hooks/wiki-session-start.js`
- `.gemini/settings.json`
- `.gemini/hooks/wiki-session-start.js`

Git hook files:

- `.githooks/prepare-commit-msg`
- `.githooks/wiki-commit-trailers.js`

Wiki directories:

- `wiki/canonical/`
- `wiki/roadmaps/`
- `wiki/plans/`
- `wiki/decisions/`
- `wiki/inbox/`
- `wiki/meta/`
- `wiki/sources/`
- `wiki/migration/`

Seed wiki pages and routers:

- `wiki/startup.md`
- `wiki/index.md`
- `wiki/meta/document-taxonomy.md`

Empty project pages such as `canonical/project-brief.md`, `canonical/open-questions.md`, `canonical/assumptions.md`, `canonical/risks.md`, and ADR templates are not created until there is real content to store. The router can discover them later with `--refresh-index`. During migration, form-only legacy templates are recorded as skipped in `wiki/migration/inventory.md` instead of becoming review rows or new wiki pages.

MCP server registration is a preservation-first merge into `mcpServers` for Claude Code (`.mcp.json`), Cursor (`.cursor/mcp.json`), and Gemini CLI (`.gemini/settings.json`). The disposable code-evidence cache is `.project-wiki/code-evidence.sqlite`.

## How It Works

1. Bootstrap creates a preservation-first wiki structure and marker-bounded agent instruction sections.
2. Session-start hooks inject only `wiki/startup.md` and `wiki/index.md`, with character budgets.
3. Bootstrap avoids empty form-only project pages; focused canonical, decision, source, and meta pages are created when content actually exists.
4. Detailed planning truth stays in canonical, decision, source, and meta pages that agents read on demand.
5. New project-planning content is classified before it is written or consolidated, keeping upstream/downstream document relationships visible.
6. `--refresh-index` routes newly discovered wiki pages; large route sets are split into `wiki/indexes/auto-*.md` scoped routers.
7. `--code-index` creates a disposable SQLite evidence cache under `.project-wiki/`.
8. `--code-report`, `--code-impact`, `--code-context-pack`, `--code-search-symbol`, and `--code-query` expose code-backed evidence for planning updates.
9. Wiki producers keep writing the canonical markdown/YAML schema, while read-only consumers such as diagnostics and MCP inspect source documents without mutating them.
10. Diagnostics report broken links, duplicate routes, orphan pages, topology warnings, stale pages, missing TL;DRs, evidence gaps, and migration policy violations.

Migration is intentionally review-first. `--migrate` preserves an existing `wiki/` as `wiki_legacy*`, skips form-only/template legacy files, splits mixed legacy pages into meaning units, classifies each unit through the document taxonomy, and writes review files under `wiki/migration/`:

- `inventory.md` records migratable legacy markdown files, file-level classification, and form-only/template files skipped from semantic migration.
- `unit-map.md` records each heading, paragraph, list item, table row, and code block with its suggested taxonomy area and target page.
- `split-plan.md` groups those units by suggested new wiki target, so one legacy page that mixes API specs, features, UX, QA, policy, or operations can be rewritten into separate files.
- `coverage.md` is the editable status ledger for each unit: pending, adopted, merged, superseded, rejected, resolved, or needs-human-review.
- `verification.md` and `review.md` summarize coverage and semantic completion after `--review-migration`.

`--migration-lint` validates that `coverage.md`, `unit-map.md`, and `split-plan.md` still account for the current migration batch, including duplicate/stale unit IDs, invalid storage/confidence/status values, split count drift, target drift, and old coverage-table schemas. When a legacy page has units that point to multiple targets, `--review-migration` will not let a file-level inbox status complete every unit; unit-level coverage must be resolved instead.

Retained or copied legacy content is acceptable when it fits the new wiki policy and structure; the new wiki must not depend on citing `wiki_legacy*`.
