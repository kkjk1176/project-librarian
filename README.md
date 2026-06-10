# Project Librarian

[![npm version](https://img.shields.io/npm/v/project-librarian.svg?cacheSeconds=300)](https://www.npmjs.com/package/project-librarian)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.13-brightgreen.svg)](https://nodejs.org/)
[![Code evidence index](https://img.shields.io/badge/code%20evidence-node%3Asqlite-blue.svg)](https://nodejs.org/api/sqlite.html)

Compact project memory and code evidence for Codex, Claude Code, Cursor, and Gemini CLI.

Project Librarian creates a repo-local planning wiki, compact startup hooks, and an optional SQLite code evidence index so agents can start with the project plan, route to the right document, and inspect code-backed evidence without repeatedly scanning the whole repository.

Languages: [English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [简体中文](README.zh.md)

## Why It Exists

LLM coding agents waste context and tool calls when every session starts by rediscovering the project: reading old chats, scanning markdown, grepping source, and guessing which files matter.

Project Librarian gives agents two local sources of truth:

| Surface | What It Gives The Agent |
| --- | --- |
| `wiki/startup.md` + `wiki/index.md` | A compact session-start summary and router, so only the relevant planning pages are read. |
| `wiki/canonical/` and `wiki/decisions/` | Current project facts, constraints, risks, package contracts, CLI behavior, and durable decisions. |
| `.codex/`, `.claude/`, `.cursor/`, and `.gemini/` hooks | Automatic startup context for Codex, Claude Code, Cursor, and Gemini CLI without loading the full wiki. |
| `GEMINI.md` and `.cursor/rules/` | Gemini CLI and Cursor instruction files that route agents to the same compact wiki-first contract. |
| `.project-wiki/code-evidence.sqlite` | Regenerable code evidence for files, symbols, imports, routes, ownership, workspace graph, reports, and impact checks. |
| Diagnostics and migration modes | Link checks, quality checks, migration inboxes, stale-signal reports, and issue drafts when the workflow exposes a problem. |

The core idea is not "write more docs." It is "keep the first agent read small, then give it reliable routes to deeper project truth and code evidence."

## Benchmark Results

Benchmarks are maintainer release evidence, not a public user workflow. They exist so README and release notes can make bounded claims with numbers instead of vague performance language.

Latest clean large report: `benchmarks/reports/current-large.json`, generated 2026-06-09T08:08:07.238Z on Node v22.19.0, darwin arm64, Apple M4 Pro, commit `18e730882c4f`, 5 measured runs with 1 discarded warmup run. Timing status was `stable`; unstable metrics were `none`; the report source-control fingerprint was clean.

| Metric | Result |
| --- | ---: |
| Median estimated Markdown context avoidance | 99.61% |
| Minimum estimated Markdown context avoidance | 99.43% |
| Median read-time reduction | 99.47% |
| Minimum read-time reduction | 99.26% |
| Wiki pages measured | 1,601 |
| Code-index files | 1,608 |
| Code-index time | 336.312ms |
| Code-index throughput | 4,781.27 files/sec |
| Incremental index time | 186.776ms |
| Full-to-incremental time reduction | 45.52% |
| Architecture report time | 251.175ms |
| Architecture report evidence tables | 6 |
| Architecture report routes | 24 |
| Sample repos | 3 |
| Benchmark runs | 5 |
| Warmup runs | 1 |
| Timing status | stable |
| Unstable metrics | none |

Scenario summary:

| Scenario | Scale | Result |
| --- | ---: | --- |
| Docs-heavy wiki | 500 pages | 99.74% estimated Markdown context avoidance, 99.47% read reduction, 43.83ms query |
| Monorepo wiki | 320 pages | 99.43% estimated Markdown context avoidance, 99.26% read reduction, 81.12ms doctor |
| Scoped router wiki | 720 pages | 99.61% estimated Markdown context avoidance, 99.55% read reduction, 67.684ms refresh |
| Code-heavy mixed index | 1,608 files | 336.312ms full index, 186.776ms incremental, 251.175ms report, 626.969ms Tree-sitter index |
| Sample repo validation | 3 repos, 16 files | 132.363ms median code index, 135.694ms median architecture report |

Claim boundary: token estimates use `ceil(characters / 4)` as a Markdown context-size estimate. They are not model tokenizer output, API billing counters, or measured real LLM token consumption. The benchmark compares the wiki context read by targeted retrieval against a naive full-wiki scan that reads every wiki Markdown file in the fixture. Code-index metrics are local CLI subprocess timings over generated and sample repositories; sample repo values are observational evidence for those explicit fixtures.

## Install

Use `npx` only for initial skill installation:

```bash
npx project-librarian install-skill --scope user --agents all
```

Install into the current repository instead:

```bash
npx project-librarian install-skill --scope project --agents all
```

`install-skill` copies reusable skill files only. It does not create or update `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `wiki/`, `.cursor/rules/`, `.cursor/hooks.json`, `.gemini/settings.json`, `.codex/hooks.json`, or `.claude/settings.json`.

| Situation | Command |
| --- | --- |
| Install globally for all supported agents | `npx project-librarian install-skill --scope user --agents all` |
| Install in the current repository | `npx project-librarian install-skill --scope project --agents all` |
| Install only Codex | `npx project-librarian install-skill --agents codex` |
| Install only Claude Code | `npx project-librarian install-skill --agents claude` |
| Install only Cursor | `npx project-librarian install-skill --agents cursor` |
| Install only Gemini CLI | `npx project-librarian install-skill --agents gemini` |
| Preview install output | `npx project-librarian install-skill --scope project --agents all --dry-run` |

`--agents` also accepts comma-separated values such as `codex,claude,cursor,gemini`. `all` targets every supported agent; `both` remains a Codex/Claude compatibility alias. `--scope` accepts `user` or `project`.

## Agent Runner

After installation, agents should run the installed local copy with `node`, not `npx`. This avoids network access and unpinned package execution in restricted agent environments.

| Installation | Runner |
| --- | --- |
| Project-scoped Codex skill | `node .codex/skills/project-librarian/dist/init-project-wiki.js` |
| Project-scoped Claude skill | `node .claude/skills/project-librarian/dist/init-project-wiki.js` |
| Project-scoped Cursor skill | `node .cursor/skills/project-librarian/dist/init-project-wiki.js` |
| Project-scoped Gemini skill | `node .gemini/skills/project-librarian/dist/init-project-wiki.js` |
| User-scoped Codex skill | `node ~/.codex/skills/project-librarian/dist/init-project-wiki.js` |
| User-scoped Claude skill | `node ~/.claude/skills/project-librarian/dist/init-project-wiki.js` |
| User-scoped Cursor skill | `node ~/.cursor/skills/project-librarian/dist/init-project-wiki.js` |
| User-scoped Gemini skill | `node ~/.gemini/skills/project-librarian/dist/init-project-wiki.js` |

The examples below use:

```bash
PROJECT_LIBRARIAN="node .codex/skills/project-librarian/dist/init-project-wiki.js"
```

Use the matching local runner for your install location.

## Common Agent Workflows

Bootstrap or update the wiki from the project root:

```bash
$PROJECT_LIBRARIAN
```

Validate and maintain the wiki:

| Goal | Agent Command |
| --- | --- |
| Create or update the wiki | `$PROJECT_LIBRARIAN` |
| Migrate existing docs/wiki content | `$PROJECT_LIBRARIAN --migrate` |
| Validate generated setup | `$PROJECT_LIBRARIAN --lint` |
| Check links and document quality | `$PROJECT_LIBRARIAN --doctor` |
| Refresh generated routing before diagnostics | `$PROJECT_LIBRARIAN --doctor --fix` |
| Search project wiki content | `$PROJECT_LIBRARIAN --query "authentication decisions"` |
| Capture a candidate note | `$PROJECT_LIBRARIAN --capture-inbox --title "Candidate" --content "Details"` |
| Report stale or unresolved wiki pages | `$PROJECT_LIBRARIAN --prune-check` |
| Install hook files without changing git config | `$PROJECT_LIBRARIAN --no-git-config` |

Build and inspect code evidence:

| Goal | Agent Command |
| --- | --- |
| Build the default evidence cache | `$PROJECT_LIBRARIAN --code-index --code-scope src` |
| Build multiple scopes | `$PROJECT_LIBRARIAN --code-index --code-scope src --code-scope packages/api` |
| Require incremental update | `$PROJECT_LIBRARIAN --code-index --incremental` |
| Force a full rebuild | `$PROJECT_LIBRARIAN --code-index --code-index-full` |
| Use optional Tree-sitter backend | `$PROJECT_LIBRARIAN --code-index --code-parser tree-sitter` |
| Show cache status | `$PROJECT_LIBRARIAN --code-status` |
| List indexed files | `$PROJECT_LIBRARIAN --code-files` |
| Print architecture and ownership report | `$PROJECT_LIBRARIAN --code-report` |
| Print one report section | `$PROJECT_LIBRARIAN --code-report --code-report-section routes` |
| Inspect impact evidence | `$PROJECT_LIBRARIAN --code-impact healthHandler` |
| Search indexed symbols | `$PROJECT_LIBRARIAN --code-search-symbol Auth` |
| Run conservative read-only SQL | `$PROJECT_LIBRARIAN --code-query "select path from files order by path"` |

Only one code evidence mode can run at a time. `--incremental`, `--code-index-full`, and `--code-parser` are valid only with `--code-index`.

## What Gets Installed

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
- `wiki/decisions/`
- `wiki/inbox/`
- `wiki/meta/`
- `wiki/sources/`
- `wiki/migration/`

Disposable code evidence cache:

- `.project-wiki/code-evidence.sqlite`

## How It Works

1. Bootstrap creates a preservation-first wiki structure and marker-bounded agent instruction sections.
2. Session-start hooks inject only `wiki/startup.md` and `wiki/index.md`, with character budgets.
3. Detailed planning truth stays in canonical, decision, source, and meta pages that agents read on demand.
4. `--refresh-index` routes newly discovered wiki pages; large route sets are split into `wiki/indexes/auto-*.md` scoped routers.
5. `--code-index` creates a disposable SQLite evidence cache under `.project-wiki/`.
6. `--code-report`, `--code-impact`, `--code-search-symbol`, and `--code-query` expose code-backed evidence for planning updates.
7. Diagnostics report broken links, duplicate routes, orphan pages, stale pages, missing TL;DRs, evidence gaps, and migration copy risks.

Migration is intentionally review-first. `--migrate` preserves an existing `wiki/` as `wiki_legacy*`, writes migration inboxes, and avoids copying legacy markdown directly into new canonical truth.

## Language Support Matrix

The matrix lists languages with implemented symbol/import extraction. Other recognized extensions are inventory-only. Default mode uses `typescript-ast`, `python-light`, `go-light`, config extraction, and inventory rows. `--code-parser tree-sitter` switches supported source files to `tree-sitter-*` profiles.

| Language | Extensions | Default extraction | Tree-sitter extraction | Indexed evidence |
| --- | --- | --- | --- | --- |
| TypeScript | `.ts`, `.tsx`, `.cts`, `.mts` | `typescript-ast` | `tree-sitter-typescript`, `tree-sitter-tsx` | functions, classes, methods, variables, interfaces, types, enums, imports, exports, calls, common HTTP routes |
| JavaScript | `.js`, `.jsx`, `.cjs`, `.mjs` | `typescript-ast` | `tree-sitter-javascript` | functions, classes, methods, variables, imports, exports, `require()` calls, calls, common HTTP routes |
| Python | `.py` | `python-light` | `tree-sitter-python` | functions, classes, `import`, `from ... import` |
| Go | `.go` | `go-light` | `tree-sitter-go` | functions, methods, types, consts, vars, single imports, import blocks |
| Rust | `.rs` | inventory-only | `tree-sitter-rust` | functions, structs, enums, traits, impls, `use` imports |
| Java | `.java` | inventory-only | `tree-sitter-java` | classes, interfaces, enums, methods, imports |
| PHP | `.php` | inventory-only | `tree-sitter-php` | functions, classes, interfaces, traits, methods, namespace uses |
| Kotlin | `.kt`, `.kts` | inventory-only | `tree-sitter-kotlin` | functions, classes, objects, imports |
| Swift | `.swift` | inventory-only | `tree-sitter-swift` | functions, classes, structs, protocols, enums, imports |
| C | `.c`, `.h` | inventory-only | `tree-sitter-c` | functions, structs, enums, includes |
| C++ | `.cc`, `.cpp`, `.cxx`, `.hpp`, `.hh`, `.hxx` | inventory-only | `tree-sitter-cpp` | functions, classes/structs, namespaces, enums, includes/usings |
| C# | `.cs` | inventory-only | `tree-sitter-csharp` | classes, interfaces, structs, enums, methods, usings |

Recognized but inventory-only extensions include `.rb`, `.vue`, and `.css`. Config files (`.json`, `.yaml`, `.yml`, `.toml`, `.env.example`, `package.json`, `tsconfig.json`, `Dockerfile`, and `Makefile`) are indexed as configuration or inventory evidence.

## CLI Reference

Use the local runner for agent execution:

```bash
$PROJECT_LIBRARIAN [init] [options]
$PROJECT_LIBRARIAN install-skill [--scope user|project] [--agents codex|claude|cursor|gemini|all|both]
```

Important options:

| Option | Purpose |
| --- | --- |
| `--migrate`, `--adopt-existing` | Preserve an existing wiki as `wiki_legacy*` and create migration inboxes. |
| `--lint` | Validate generated setup without editing files. |
| `--link-check` | Report broken wiki links, duplicate routes, and orphan pages. |
| `--quality-check` | Report stale, conflicting, and low-quality wiki document signals. |
| `--doctor` | Run lint, link-check, and quality-check together. |
| `--doctor --fix` | Safely refresh generated index routing before diagnostics. |
| `--query <terms>` | Search wiki paths, metadata, titles, and bodies. |
| `--refresh-index` | Update generated auto-discovered wiki routing. |
| `--capture-inbox --title <title> --content <content>` | Append a candidate note to the wiki inbox. |
| `--issue-draft --issue-title <title>` | Print a read-only GitHub issue body draft for problems or side effects. |
| `--issue-create --issue-title <title>` | Create a GitHub issue through `gh` after explicit user approval. |
| `--glossary-init` | Create and route the optional glossary page. |
| `--prune-check` | Report active pages with stale or unresolved lifecycle signals. |
| `--review-migration`, `--semantic-migrate` | Sync migration inbox statuses into migration review files. |
| `--no-git-config` | Install hook files without changing `git core.hooksPath`. |
| `--code-index` | Build the disposable code evidence index. |
| `--code-report` | Print architecture and ownership summaries from the evidence index. |
| `--code-report-section <section>` | Print one section: `coverage`, `ownership`, `languages`, `parsers`, `workspaces`, `workspace-graph`, `routes`, `hotspots`, `configs`, or `edges`. |
| `--code-impact <term>` | Show file, symbol, route, import, edge, and owner impact evidence. |
| `--code-search-symbol <term>` | Search indexed symbols. |
| `--code-query <sql>` | Run conservative read-only SQL over the evidence index. |

## Development

The source is TypeScript. The committed `dist/` directory is the compiled JavaScript used by the npm binary and installed skill copies.

```bash
npm install
npm run typecheck
npm run build
npm test
npm pack --dry-run
```

When editing TypeScript under `src/`, rebuild before committing so `dist/` stays current.

Maintainer benchmark commands live in [benchmarks/README.md](benchmarks/README.md). They are for release evidence and public claim validation, not normal end-user setup.

## Inspiration

This project is inspired by Andrej Karpathy's [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) pattern: keep persistent markdown context close to the work instead of reconstructing project state from long chat history.

Project Librarian adapts that idea into an installable CLI and skill for Codex, Claude Code, Cursor, and Gemini CLI, with repo-local instructions, compact startup hooks, migration helpers, diagnostics, and optional code evidence.

## License

MIT
