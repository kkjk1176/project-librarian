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

Benchmarks are maintainer release evidence, not a public user workflow. They exist so README and release notes can make bounded claims with numbers instead of vague performance language. All values are real Codex JSONL usage and local wall-clock measurements (ChatGPT/Codex auth, `gpt-5.5`), measured hermetically (isolated Codex home, allowlist-only env, clean tree, post-run fixture validation) with 3 measured runs plus 1 warmup per scenario against an `organic` no-Project-Librarian control. Negative deltas mean the Project Librarian condition cost less than the control.

The headline metric is cost-weighted tokens (uncached input + 0.1 × cached input + output + reasoning output): cached resends are discounted because they do not cost full price, and merged totals would structurally penalize any tool that adds turns. The wiki routing track and the code-graph (code evidence) track are measured and reported separately — a win on one track does not back a claim about the other. The earlier 2026-06-10 one-run report (`current-local.*`) is superseded by these hermetic measurements.

### Wiki track (planning-doc routing)

Reports: `benchmarks/reports/llm/stage1-organic.*` and `benchmarks/reports/llm/stage1-large-retry.*` (2026-06-11). Cost-weighted deltas, with vs without Project Librarian:

| Scale | decision_lookup | aggregation | multi_session (2nd session) |
| --- | ---: | ---: | ---: |
| Small | -7.9% | +7.0% | -30.4% |
| Medium | -69.5% | +8.8% | -56.6% |
| Large (gate-passed retry) | -62.6% | -45.0%* | -70.7% |

Claim-grade cells (claim gate passed, every run passing correctness): large `decision_lookup` (-62.6% cost-weighted, -41.5% wall time) and large `multi_session` (-70.7% cost-weighted, -33.9% wall time). Boundaries disclosed with the claims: `aggregation` at small/medium is a published loss (+7-9%), aggregation wall time is longer with the wiki at every scale even where tokens drop, and *large aggregation (-45.0%) comes from the Stage 1 run whose track gate failed on control-side correctness flakes, so it remains investigation evidence rather than a claim.

### Code-graph track (code evidence index)

Report: `benchmarks/reports/llm/stage2d-codegraph.*` (2026-06-11, claim gate passed 18/18) — measured on representativeness-deepened fixtures (scale-proportional CODEOWNERS at 20/80/250 rules with precedence cases, multi-hop dependency chains, traversal-requiring questions), with fixtures advertising the product's task-shaped commands (`--code-impact`, `--code-report` sections). Cost-weighted deltas:

| Scale | impact_trace | ownership_lookup | workspace_graph |
| --- | ---: | ---: | ---: |
| Small | +101% | +47% | +79% |
| Medium | +29% | +64% | -5% |
| Large | +217% | +87% | +49% |

The overhead replicated across three gate-valid variations (deepened structure, fixed evaluator, task-shaped interface), so no code-graph performance claims are made — published as a measured boundary per the losing-scenarios policy. The control answers multi-hop structural questions with 3-9 targeted greps, while any tool interaction (discovery, invocation, output verification) costs more than it saves at these fixture scales.

#### Real-repository corpus (claim gate passed)

Reports: `benchmarks/reports/llm/stageR1-real.*` and `stageR1-real-rescored.*` (2026-06-12, claim gate passed with 30/30 runs correct after two evaluator false positives were fixed and the report was re-scored from its raw JSONL — originals preserved, recompute-from-raw is the standing audit policy). SHA-pinned excalidraw (~1.2k files) and backstage (~11.8k files), hand-authored answer keys, and the answer-shaped MCP tools injected into the hermetic Codex home. Cost-weighted deltas:

| Question | excalidraw (~1.2k files) | backstage (~11.8k files) |
| --- | ---: | ---: |
| impact_trace | +117% | **-27.7%** |
| workspace_graph | +106% | -2.6% |
| ownership_lookup | — | +99% |

A scale crossover is the claim: on the 11.8k-file repository the tool wins the expensive traversal question (impact_trace -27.7% cost-weighted, scan bytes -24.5%) and break-evens the workspace graph, while everything loses on the small repository and cheap lookups (CODEOWNERS ownership) lose at every measured scale — the losing cells are published with the winning one. This boundary is what the scale-aware gates in the CLI now encode: below ~5k indexable files, `--code-index` asks for explicit acknowledgement and bootstrap skips MCP auto-registration, citing these measurements.

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

MCP server registration (preservation-first merge into `mcpServers`):

- `.mcp.json` (Claude Code)
- `.cursor/mcp.json` (Cursor)
- `.gemini/settings.json` `mcpServers` (Gemini CLI)

Disposable code evidence cache:

- `.project-wiki/code-evidence.sqlite`

## Code Evidence MCP Server

`project-librarian mcp` runs a hand-rolled stdio MCP server (JSON-RPC 2.0 over newline-delimited JSON, no extra runtime dependencies) that serves the existing `.project-wiki` code-evidence index read-only. It exposes answer-shaped tools — `code_impact`, `code_ownership` (CODEOWNERS last-match precedence), `code_workspace_graph`, `code_search`, and `code_status` — whose responses lead with a one-line answer, follow with compact path/symbol/signature evidence, cap each reply, and prepend a warning when `code_status` reports the index is stale.

Bootstrap registers the server for Claude Code (`.mcp.json`), Cursor (`.cursor/mcp.json`), and Gemini CLI (`mcpServers` in `.gemini/settings.json`), preserving any existing servers and keys and reporting `exists` on a re-run. When the repository contains a local runner the registration uses `node <runner> mcp`; otherwise it uses the installed `project-librarian mcp` binary.

Codex registers MCP servers at the user level only (`codex mcp add`), so bootstrap does not write a project-level Codex MCP config. To use the server with Codex, run it once per machine:

```bash
codex mcp add project-librarian -- node .codex/skills/project-librarian/dist/init-project-wiki.js mcp
```

## How It Works

1. Bootstrap creates a preservation-first wiki structure and marker-bounded agent instruction sections.
2. Session-start hooks inject only `wiki/startup.md` and `wiki/index.md`, with character budgets.
3. Detailed planning truth stays in canonical, decision, source, and meta pages that agents read on demand.
4. `--refresh-index` routes newly discovered wiki pages; large route sets are split into `wiki/indexes/auto-*.md` scoped routers.
5. `--code-index` creates a disposable SQLite evidence cache under `.project-wiki/`.
6. `--code-report`, `--code-impact`, `--code-search-symbol`, and `--code-query` expose code-backed evidence for planning updates.
7. Diagnostics report broken links, duplicate routes, orphan pages, stale pages, missing TL;DRs, evidence gaps, and migration policy violations.

Migration is intentionally review-first. `--migrate` preserves an existing `wiki/` as `wiki_legacy*`, writes migration inboxes and a unit-level coverage ledger, and restructures legacy meaning into the current wiki rules. Retained or copied legacy content is acceptable when it fits the new wiki policy and structure; the new wiki must not depend on citing `wiki_legacy*`.

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
| `--migration-lint` | Validate migration review scaffolding separately from normal lint. |
| `--migration-quality-check` | Report migration policy/structure signals separately from normal quality-check. |
| `--migration-doctor` | Run migration-lint and migration-quality-check together. |
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
