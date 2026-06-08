# Project Wiki Bootstrap

[![npm version](https://img.shields.io/npm/v/project-wiki-bootstrap.svg)](https://www.npmjs.com/package/project-wiki-bootstrap)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-brightgreen.svg)](https://nodejs.org/)
[![Code evidence index](https://img.shields.io/badge/code%20evidence-node%3Asqlite-blue.svg)](https://nodejs.org/api/sqlite.html)

Bootstrap a small project planning wiki for humans and LLM coding agents.

Languages: [English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [简体中文](README.zh.md)

The generated wiki keeps startup context small:

- `wiki/startup.md`: current project summary
- `wiki/index.md`: router for detailed pages to read next
- `wiki/canonical/`, `wiki/decisions/`, `wiki/sources/`, and `wiki/meta/`: detailed context loaded only when needed

## What You Get

Project Wiki Bootstrap creates a repo-local planning memory that coding agents can read predictably.

Core features:

- Wiki-first project instructions for Codex and Claude Code
- Session-start hooks that load only compact startup context
- Canonical pages for current project facts, assumptions, risks, decisions, and sources
- Wiki diagnostics for broken links, duplicate routes, orphan pages, stale signals, and quality gaps
- Migration support for existing markdown docs
- Optional code evidence index for code-backed wiki updates in larger repositories

The result is less repeated context gathering. Agents can start with the current project intent, read detailed pages only when needed, and leave project decisions in files that humans can review.

## Quick Start

### 1. Install the Skill

Install the skill once for Codex and Claude Code:

```bash
npx project-wiki-bootstrap install-skill --scope user --agents both
```

Use `--scope project` to install the skill into the current repository instead:

```bash
npx project-wiki-bootstrap install-skill --scope project --agents both
```

`install-skill` only installs reusable skill files under `.codex/skills/` and/or `.claude/skills/`. It does not create or update `AGENTS.md`, `CLAUDE.md`, `wiki/`, `.codex/hooks.json`, or `.claude/settings.json`.

Install options:

| Situation | Command |
| --- | --- |
| Install for Codex and Claude Code globally | `npx project-wiki-bootstrap install-skill --scope user --agents both` |
| Install for Codex and Claude Code in the current repository | `npx project-wiki-bootstrap install-skill --scope project --agents both` |
| Install for only one agent | `npx project-wiki-bootstrap install-skill --agents codex` or `--agents claude` |

### Local Runner For Agent Sessions

After the skill is installed, Codex and Claude Code should run the installed local copy instead of fetching the package from npm again. This avoids network failures and avoids unpinned public package execution in restricted agent environments.

Common local runners:

| Installation | Runner |
| --- | --- |
| Project-scoped Codex skill | `node .codex/skills/project-wiki-bootstrap/dist/init-project-wiki.js` |
| Project-scoped Claude skill | `node .claude/skills/project-wiki-bootstrap/dist/init-project-wiki.js` |
| User-scoped Codex skill | `node ~/.codex/skills/project-wiki-bootstrap/dist/init-project-wiki.js` |
| User-scoped Claude skill | `node ~/.claude/skills/project-wiki-bootstrap/dist/init-project-wiki.js` |

Direct shell users can still use `npx project-wiki-bootstrap ...` when registry access is available. Agents using the installed skill should prefer the local runner and should report the real error if it fails instead of manually recreating generated files as a fallback.

### 2. Bootstrap or Maintain the Project Wiki

After installing the skill, run the wiki command from the target project root:

```bash
npx project-wiki-bootstrap
```

Wiki commands:

| Situation | Command |
| --- | --- |
| Create or update the wiki | `npx project-wiki-bootstrap` |
| Migrate existing docs/wiki content | `npx project-wiki-bootstrap --migrate` |
| Check links and document quality | `npx project-wiki-bootstrap --doctor` |
| Safely refresh generated routing while checking | `npx project-wiki-bootstrap --doctor --fix` |
| Install hook files without changing git config | `npx project-wiki-bootstrap --no-git-config` |

## Skill Actions

After installation, ask Codex or Claude Code to:

- bootstrap, update, or validate the project wiki
- check wiki links, duplicate routes, orphan pages, and document quality
- search wiki pages
- refresh `wiki/index.md`
- capture a candidate note into `wiki/inbox/project-candidates.md`
- report stale or undecided wiki pages
- draft a GitHub issue body for problems or side effects found while using the skill
- create `wiki/canonical/glossary.md`
- migrate existing markdown docs into reviewable inboxes
- analyze code and update wiki pages with code-backed evidence

Examples:

```text
Apply project-wiki-bootstrap to this project.
Validate the project wiki setup.
Search the project wiki for authentication decisions.
Analyze apps/web and packages/api, then update the wiki from the code.
Review the migrated wiki inbox.
```

In Claude Code, you can also invoke `/project-wiki-bootstrap`.

## Wiki Diagnostics

Use diagnostics when the wiki exists but needs review or cleanup:

| Purpose | Command |
| --- | --- |
| Validate generated setup | `npx project-wiki-bootstrap --lint` |
| Check broken links, duplicate index routes, and orphan pages | `npx project-wiki-bootstrap --link-check` |
| Check stale pages, unresolved signals, missing TL;DRs, budget drift, and evidence gaps | `npx project-wiki-bootstrap --quality-check` |
| Run setup, link, and quality checks together | `npx project-wiki-bootstrap --doctor` |
| Apply safe routing fixes before diagnostics | `npx project-wiki-bootstrap --doctor --fix` |

Broken links fail the check. Duplicate routes, orphan pages, and quality findings are reported as actionable warnings so humans or agents can decide whether to merge, route, refresh, or rewrite documents.

## GitHub Issue Drafts

Use issue drafts when a project-wiki-bootstrap run caused a side effect, exposed confusing behavior, failed in a specific environment, or generated unexpected files:

```bash
npx project-wiki-bootstrap --issue-draft --issue-title "Report unexpected wiki hook behavior"
```

The command is read-only. It prints a Markdown problem-report template with reproduction steps, expected vs actual behavior, side effects, affected generated files, environment context, and diagnostics to attach. It does not create a GitHub issue or require network access.

When an LLM using this skill discovers a project-wiki-bootstrap bug, regression, workflow mismatch, confusing generated behavior, or unintended side effect, the LLM runs the read-only issue draft before finishing the work unless the user explicitly says they do not want an issue draft. This does not replace fixing the local problem.

## What Gets Installed

Project instruction files:

- `AGENTS.md`
- `CLAUDE.md`
- `wiki/AGENTS.md`

Startup hooks:

- `.codex/hooks.json`
- `.codex/hooks/wiki-session-start.js`
- `.claude/settings.json`
- `.claude/hooks/wiki-session-start.js`

Optional git hook files:

- `.githooks/prepare-commit-msg`
- `.githooks/wiki-commit-trailers.js`

Wiki directories:

- `wiki/canonical/`
- `wiki/decisions/`
- `wiki/meta/`
- `wiki/sources/`
- `wiki/inbox/`
- `wiki/migration/`

## Code Evidence Index

For large repositories, the skill can build a disposable SQLite evidence cache:

```bash
npx project-wiki-bootstrap --code-index --code-scope src
```

The cache lives under `.project-wiki/` and is regenerated as needed. It is evidence for wiki updates, not canonical wiki content. Code changes are not watched automatically; inspection commands report stale cache counts or warnings so you can rerun `--code-index` intentionally. `.env*` files other than `.env.example` and obvious sensitive config filenames containing secret, credential, token, private, or key terms are excluded by default.

Useful commands:

| Purpose | Command |
| --- | --- |
| Build or refresh the cache | `npx project-wiki-bootstrap --code-index --code-scope src` |
| Show counts and stale cache status | `npx project-wiki-bootstrap --code-status` |
| List indexed files | `npx project-wiki-bootstrap --code-files` |
| Search symbols | `npx project-wiki-bootstrap --code-search-symbol Auth` |
| Run read-only SQL | `npx project-wiki-bootstrap --code-query "select path from files order by path"` |

Code evidence indexing requires a Node runtime with `node:sqlite`. The base bootstrap command supports Node 18+, but the evidence index currently needs a newer Node release that includes `node:sqlite`.

## Language Support Matrix

The matrix lists only languages with implemented symbol/import extraction. Other recognized extensions are inventory-only and are not counted as language support.

| Language | Extensions | Extraction profile | Indexed evidence |
| --- | --- | --- | --- |
| TypeScript | `.ts`, `.tsx`, `.cts`, `.mts` | `typescript-ast` | functions, classes, methods, variables, interfaces, types, enums, imports, exports, calls, common HTTP routes |
| JavaScript | `.js`, `.jsx`, `.cjs`, `.mjs` | `typescript-ast` | functions, classes, methods, variables, imports, exports, `require()` calls, calls, common HTTP routes |
| Python | `.py` | `python-light` | functions, classes, `import`, `from ... import` |

Config files (`.json`, `.yaml`, `.yml`, `.toml`, `.env.example`, `package.json`, `tsconfig.json`) are indexed separately as configuration evidence.

## Policies And Side Effects

- In a git repository, bootstrap configures `git config core.hooksPath .githooks` by default when `core.hooksPath` is unset.
- If another `core.hooksPath` already exists, bootstrap preserves it and reports the skipped git config change.
- Use `--no-git-config` to install hook files without changing `core.hooksPath`.
- Existing `AGENTS.md`, `CLAUDE.md`, and `wiki/AGENTS.md` files are preserved outside project-wiki marker blocks.
- Generated operating documents are English by default. Project canonical wiki content should follow the user's instruction or the project's existing language.

## Inspiration

This project is inspired by Andrej Karpathy's [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) pattern: keep a persistent markdown wiki close to the work instead of reconstructing project context from long chat history.

Project Wiki Bootstrap adapts that idea into an installable bootstrap for Codex and Claude Code, with repo-local instructions, startup hooks, migration helpers, and optional code evidence.

## Development

The source is TypeScript. The committed `dist/` directory is the compiled JavaScript used by the npm binary and skill installation.

Repository layout:

- `src/init-project-wiki.ts`: CLI entrypoint
- `src/args.ts`: command-line argument parsing
- `src/hooks.ts`: Codex, Claude Code, and git hook generation
- `src/install-skill.ts`: user/project skill installer
- `src/templates.ts`: generated instruction and wiki templates
- `src/code-index.ts`: optional SQLite code evidence index
- `src/wiki-files.ts`: wiki file discovery and markdown helpers
- `src/migration.ts`: existing wiki migration
- `src/modes.ts`: lint, search, refresh, capture, and prune modes
- `dist/`: compiled output

Development commands:

```bash
npm install
npm run typecheck
npm run build
npm test
npm pack --dry-run
```

When editing TypeScript files under `src/`, rebuild before committing so `dist/` stays current.

## License

MIT
