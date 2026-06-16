# Project Librarian

[![npm version](https://img.shields.io/npm/v/project-librarian.svg?cacheSeconds=300)](https://www.npmjs.com/package/project-librarian)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.13-brightgreen.svg)](https://nodejs.org/)
[![Code evidence index](https://img.shields.io/badge/code%20evidence-node%3Asqlite-blue.svg)](https://nodejs.org/api/sqlite.html)

**Give every AI coding agent the same durable memory of your project.** Project Librarian keeps a compact, repo-local planning wiki — plus an optional code-evidence index — that Codex, Claude Code, Cursor, and Gemini CLI read at session start, so they stop rediscovering your codebase from scratch every time.

Languages: [English](README.md) | [한국어](README.ko.md)

## Quick Start

Most users should ask their coding agent to run Project Librarian rather than run lifecycle commands by hand.

Install the reusable skill files once, or ask an agent with shell access to do it:

```bash
npx project-librarian install-skill --scope user --agents all
```

Then ask Codex, Claude Code, Cursor, or Gemini CLI from the target repository:

- "Use Project Librarian to set up this repository's planning wiki and run diagnostics."
- "Use Project Librarian to migrate the existing docs/wiki content."
- "Search the Project Librarian wiki for authentication decisions."

The installed skill tells the agent to resolve the local runner and execute the right command from the project root. Prefer a project-local install only when you want that runner stored inside the target repository's agent setup:

```bash
npx project-librarian install-skill --scope project --agents all
```

`install-skill` only copies the reusable runner and skill files. The agent-run lifecycle command is what creates or updates `AGENTS.md`, agent hooks, `wiki/`, git hook files, diagnostics, and optional code-evidence support.

## Highlights

- **Small first read.** Session-start hooks inject only `wiki/startup.md` and `wiki/index.md`; agents route to deeper pages on demand instead of grepping the whole repo cold.
- **One setup, four agents.** Codex, Claude Code, Cursor, and Gemini CLI share the same wiki-first contract, hooks, and rules.
- **Structured wiki writing.** New project content is classified through `wiki/meta/document-taxonomy.md` before it is written or consolidated, so PRDs, policies, UX, data, APIs, QA, release, and operations notes do not collapse into one catch-all page.
- **Inspectable wiki graph.** `--wiki-visualize` writes a self-contained HTML graph under `.project-wiki/`, showing page types, router depth, backlinks, and decision references without adding to startup context.
- **Measured, not hand-wavy.** Every performance claim comes from hermetic Codex benchmarks — and the cases where it costs *more* are shown right next to the wins.
- **Optional code evidence.** A regenerable SQLite index plus answer-shaped MCP tools answer impact, ownership, and workspace-graph questions, with zero extra runtime dependencies.
- **Safe to re-run.** Bootstrap is idempotent and preservation-first; diagnostics flag broken routes, unreachable pages, and stale truth before they mislead an agent.

## Why It Exists

LLM coding agents waste context and tool calls when every session starts by rediscovering the project: reading old chats, scanning markdown, grepping source, and guessing which files matter.

Project Librarian gives agents two local sources of truth:

| Surface | What It Gives The Agent |
| --- | --- |
| `wiki/startup.md` + `wiki/index.md` | A compact session-start summary and router, so only the relevant planning pages are read. |
| `wiki/canonical/` and `wiki/decisions/` | Current project facts, constraints, risks, package contracts, CLI behavior, and durable decisions. |
| `wiki/meta/document-taxonomy.md` | A service-lifecycle classification map that tells agents where PRD, policy, UX, data, engineering, QA, release, and operations truth should live. |
| `.codex/`, `.claude/`, `.cursor/`, and `.gemini/` hooks | Automatic startup context for Codex, Claude Code, Cursor, and Gemini CLI without loading the full wiki. |
| `GEMINI.md` and `.cursor/rules/` | Gemini CLI and Cursor instruction files that route agents to the same compact wiki-first contract. |
| `.project-wiki/code-evidence.sqlite` | Regenerable code evidence for files, symbols, imports, routes, ownership, workspace graph, reports, and impact checks. |
| `.project-wiki/wiki-graph.html` | Optional static wiki graph visualizer with derived concept types, router reachability, links, backlinks, and decision references. |
| Diagnostics and migration modes | Link checks, quality checks, migration inboxes, stale-signal reports, and issue drafts when the workflow exposes a problem. |

The core idea is not "write more docs." It is "keep the first agent read small, then give it reliable routes to deeper project truth and code evidence."

The taxonomy is a routing aid, not a mandate to create every possible document. It is strongest for service and product development. Library, infrastructure, research, or other non-service projects can use only the relevant slices and leave the rest as intentionally unused categories instead of forcing artificial pages.

## Benchmark Results

These numbers are maintainer release evidence, not a blanket promise. Every value is real Codex JSONL usage and local wall-clock time (ChatGPT/Codex auth, `gpt-5.5`), measured hermetically — isolated Codex home, allowlist-only environment, clean tree, post-run fixture validation — with 3 measured runs plus 1 warmup per scenario against an `organic` control that has no Project Librarian.

In the tables below, **"less" / "more"** compares cost-weighted tokens against that control, and **"faster" / "slower"** compares wall-clock time. (Cost-weighted = uncached input + 0.1 × cached input + output + reasoning output; cached resends are discounted, and raw merged totals would unfairly penalize any tool that adds a turn.) The wiki-routing track and the code-graph track are measured and reported separately — a win on one never backs a claim about the other. Generated benchmark reports under `benchmarks/reports/llm/` are ignored by default; maintainers should commit deliberate release baselines only when they are meant to support a public claim. Reproduce a release candidate with:

```bash
npm run benchmark:release:preview
npm run benchmark:release -- --allow-codex-run
```

### Wiki track (planning-doc routing)

Cost-weighted tokens, Project Librarian vs control:

| Scale | decision_lookup | aggregation | multi_session (2nd session) |
| --- | --- | --- | --- |
| Small | 43.8% less | 144.5% more | 5.4% more |
| Medium | 53.4% less | 4.4% less | 68.5% less |
| Large | 71.6% less* | 12.8% less | 66.0% less |

Latest synthetic wiki-track release candidate: 2026-06-16, `gpt-5.5`, 42 scenarios, 3 measured runs plus 1 warmup each. The overall claim gate **failed**: 41/42 scenarios passed correctness, but `decision_lookup` at large scale on the no-Project-Librarian control had only 2/3 correct measured runs. The failed control run selected `2026-05-04` from a dated history file instead of the expected latest benchmark-evidence decision `2026-06-10` from the decision log. Treat this table as diagnostic evidence, not a public release claim, until a clean release run passes the claim gate. Published boundaries remain visible: small `aggregation` is much more expensive with the wiki, small `multi_session` is slightly more expensive, and `aggregation` stays slower at every scale even when token cost drops.

### Code-graph track (code evidence index, real repositories)

Measured on two SHA-pinned open-source repositories with hand-authored answer keys and the answer-shaped MCP tools injected into the hermetic Codex home. The claim gate passed with 30/30 runs correct after two evaluator false positives were fixed and the report was re-scored from raw JSONL; recompute-from-raw is the standing audit policy. Cost-weighted tokens, Project Librarian vs control:

| Question | excalidraw (~1.2k files) | backstage (~11.8k files) |
| --- | --- | --- |
| impact_trace | 117% more | **27.7% less** |
| workspace_graph | 106% more | 2.6% less |
| ownership_lookup | — | 99% more |

The claim is a scale crossover, and the losses are published next to the win: on the 11.8k-file repository the tool wins the expensive traversal question (impact_trace 27.7% fewer cost-weighted tokens, 24.5% fewer scan bytes) and breaks even on the workspace graph, but everything loses on the small repository and cheap lookups (CODEOWNERS ownership) lose at every measured scale. In short, the code-evidence index pays off only on genuinely large repositories for expensive-traversal questions — exactly what the CLI's scale-aware gates encode: below ~5k indexable files, `--code-index` asks for explicit acknowledgement and bootstrap skips MCP auto-registration, citing these measurements.

### What the benchmark names mean

Repositories under test:

- **excalidraw** — a real open-source whiteboard/diagramming app (~1.2k files); the small-repo data point.
- **backstage** — Spotify's open-source developer-portal platform (~11.8k files); the large-repo data point.

Question types (task families):

- **decision_lookup** — find the latest project decision and its date from the wiki.
- **aggregation** — answer a question whose facts are scattered across several pages and must be synthesized.
- **multi_session** — a second session on the same project, measuring whether the durable wiki helps the next session, not just the first.
- **impact_trace** — "if this module changes, what else is affected?": trace the full set of direct and indirect importers.
- **ownership_lookup** — "who owns this file?": resolve the owner by CODEOWNERS last-match precedence.
- **workspace_graph** — "what does this package depend on across the monorepo?": the workspace/package dependency graph.

## Install Details

Use this section when you need to choose an install scope or target agent. Use `npx` only for initial skill installation:

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

`--agents` also accepts comma-separated values such as `codex,claude,cursor,gemini`. `all` targets every supported agent. `--scope` accepts `user` or `project`.

## Runner Paths

These paths are mainly for agents and automation. After installation, agents should run the installed local copy with `node`, not `npx`. This avoids network access and unpinned package execution in restricted agent environments.

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

## Common Agent Requests

Ask your agent for the outcome you want; the skill maps the request to the local runner internally.

Wiki setup and maintenance:

| Goal | Ask The Agent | Internal Action |
| --- | --- | --- |
| Create or update the wiki | "Use Project Librarian to set up or update this repository's planning wiki." | `[init]` |
| Update existing setup without migration | "Update this repository's Project Librarian setup without migrating the wiki." | `update` |
| Migrate existing docs/wiki content | "Use Project Librarian to migrate the existing docs/wiki content." | `--migrate` |
| Validate generated setup | "Run Project Librarian validation." | `--lint` |
| Check links and document quality | "Run Project Librarian diagnostics." | `--doctor` |
| Refresh generated routing before diagnostics | "Refresh Project Librarian routing and then run diagnostics." | `--doctor --fix` |
| Search project wiki content | "Search the Project Librarian wiki for authentication decisions." | `--query "authentication decisions"` |
| Show backlinks and decision citations for a page | "Show Project Librarian wiki impact for decisions/release-policy." | `--wiki-impact "decisions/release-policy"` |
| Generate a wiki graph visualizer | "Generate the Project Librarian wiki graph visualizer." | `--wiki-visualize` |
| Capture a candidate note | "Capture this as a Project Librarian candidate note: <details>." | `--capture-inbox --title "Candidate" --content "Details"` |
| Report stale or unresolved wiki pages | "Check Project Librarian for stale or unresolved pages." | `--prune-check` |
| Install hook files without changing git config | "Set up Project Librarian hook files without changing git config." | `--no-git-config` |

Code evidence:

| Goal | Ask The Agent | Internal Action |
| --- | --- | --- |
| Build the default evidence cache | "Build Project Librarian code evidence for `src`." | `--code-index --code-scope src` |
| Build multiple scopes | "Build Project Librarian code evidence for `src` and `packages/api`." | `--code-index --code-scope src --code-scope packages/api` |
| Require incremental update | "Update the Project Librarian code evidence index incrementally." | `--code-index --incremental` |
| Force a full rebuild | "Fully rebuild the Project Librarian code evidence index." | `--code-index --code-index-full` |
| Use optional Tree-sitter backend | "Build Project Librarian code evidence with the Tree-sitter parser." | `--code-index --code-parser tree-sitter` |
| Show cache status | "Show Project Librarian code evidence status." | `--code-status` |
| List indexed files | "List files in the Project Librarian code evidence index." | `--code-files` |
| Print architecture and ownership report | "Show the Project Librarian code report." | `--code-report` |
| Print one report section | "Show the routes section of the Project Librarian code report." | `--code-report --code-report-section routes` |
| Inspect impact evidence | "Show Project Librarian impact evidence for `healthHandler`." | `--code-impact healthHandler` |
| Build a context pack | "Build a Project Librarian context pack for `healthHandler`." | `--code-context-pack healthHandler` |
| Search indexed symbols | "Search Project Librarian code evidence for symbol `Auth`." | `--code-search-symbol Auth` |
| Run conservative read-only SQL | "Run a read-only Project Librarian code evidence query for file paths." | `--code-query "select path from files order by path"` |

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

Seed wiki pages and routers:

- `wiki/startup.md`
- `wiki/index.md`
- `wiki/meta/document-taxonomy.md`

Empty project pages such as `canonical/project-brief.md`, `canonical/open-questions.md`, `canonical/assumptions.md`, `canonical/risks.md`, and ADR templates are not created until there is real content to store. The router can discover them later with `--refresh-index`. During migration, form-only legacy templates are recorded as skipped in `wiki/migration/inventory.md` instead of becoming review rows or new wiki pages.

MCP server registration (preservation-first merge into `mcpServers`):

- `.mcp.json` (Claude Code)
- `.cursor/mcp.json` (Cursor)
- `.gemini/settings.json` `mcpServers` (Gemini CLI)

Disposable code evidence cache:

- `.project-wiki/code-evidence.sqlite`

## Code Evidence MCP Server

`project-librarian mcp` runs a hand-rolled stdio MCP server (JSON-RPC 2.0 over newline-delimited JSON, no extra runtime dependencies) that serves the existing `.project-wiki` code-evidence index read-only. It exposes answer-shaped tools — `code_context_pack`, `code_impact`, `code_ownership` (CODEOWNERS last-match precedence), `code_workspace_graph`, `code_search`, and `code_status` — whose responses lead with a one-line answer, follow with compact path/symbol/signature evidence, cap each reply, and prepend a warning when `code_status` reports the index is stale.

The server also exposes fixed resources — `project-librarian://wiki/startup`, `project-librarian://wiki/index`, and `project-librarian://code/status` — plus prompt templates for wiki taxonomy updates, code impact traces, and retrieval quality reviews. Resource reads come from a fixed URI registry rather than arbitrary filesystem paths.

Bootstrap registers the server for Claude Code (`.mcp.json`), Cursor (`.cursor/mcp.json`), and Gemini CLI (`mcpServers` in `.gemini/settings.json`), preserving any existing servers and keys and reporting `exists` on a re-run. When the repository contains a local runner the registration uses `node <runner> mcp`; otherwise it uses the installed `project-librarian mcp` binary.

Codex registers MCP servers at the user level only (`codex mcp add`), so bootstrap does not write a project-level Codex MCP config. To use the server with Codex, run it once per machine:

```bash
codex mcp add project-librarian -- node .codex/skills/project-librarian/dist/init-project-wiki.js mcp
```

## How It Works

1. Bootstrap creates a preservation-first wiki structure and marker-bounded agent instruction sections.
2. Session-start hooks inject only `wiki/startup.md` and `wiki/index.md`, with character budgets.
3. Bootstrap avoids empty form-only project pages; focused canonical, decision, source, and meta pages are created when content actually exists.
4. Detailed planning truth stays in canonical, decision, source, and meta pages that agents read on demand.
5. New project-planning content is classified through `wiki/meta/document-taxonomy.md` before it is written or consolidated, keeping upstream/downstream document relationships visible.
6. `--refresh-index` routes newly discovered wiki pages; large route sets are split into `wiki/indexes/auto-*.md` scoped routers.
7. `--code-index` creates a disposable SQLite evidence cache under `.project-wiki/`.
8. `--code-report`, `--code-impact`, `--code-context-pack`, `--code-search-symbol`, and `--code-query` expose code-backed evidence for planning updates.
9. Read-only wiki consumers share a concept read model that derives user-facing page types from paths and frontmatter without rewriting the canonical wiki schema.
10. `--wiki-visualize` writes a static graph artifact to `.project-wiki/`, reusing the wiki graph and concept read model instead of introducing a database or server.
11. Diagnostics report broken links, duplicate routes, orphan pages, stale pages, missing TL;DRs, evidence gaps, and migration policy violations.

Migration is intentionally review-first. `--migrate` preserves an existing `wiki/` as `wiki_legacy*`, skips form-only/template legacy files, splits mixed legacy pages into meaning units, classifies each unit through the document taxonomy, and writes review files under `wiki/migration/`:

- `inventory.md` records migratable legacy markdown files, file-level classification, and form-only/template files skipped from semantic migration.
- `unit-map.md` records each heading, paragraph, list item, table row, and code block with its suggested taxonomy area and target page.
- `split-plan.md` groups those units by suggested new wiki target, so one legacy page that mixes API specs, features, UX, QA, policy, or operations can be rewritten into separate files.
- `coverage.md` is the editable status ledger for each unit: pending, adopted, merged, superseded, rejected, resolved, or needs-human-review.
- `verification.md` and `review.md` summarize coverage and semantic completion after `--review-migration`.

`--migration-lint` validates that `coverage.md`, `unit-map.md`, and `split-plan.md` still account for the current migration batch, including duplicate/stale unit IDs, invalid storage/confidence/status values, split count drift, target drift, and old coverage-table schemas. When a legacy page has units that point to multiple targets, `--review-migration` will not let a file-level inbox status complete every unit; unit-level coverage must be resolved instead.

Retained or copied legacy content is acceptable when it fits the new wiki policy and structure; the new wiki must not depend on citing `wiki_legacy*`.

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

Use the resolved local runner for automation or direct CLI execution:

```bash
node .codex/skills/project-librarian/dist/init-project-wiki.js [init|update] [options]
node .codex/skills/project-librarian/dist/init-project-wiki.js install-skill [--scope user|project] [--agents codex|claude|cursor|gemini|all]
```

`update` is the explicit existing-project update command. It rejects `--migrate` and `--adopt-existing`; use top-level `--migrate` when legacy docs or wiki content should be preserved into `wiki_legacy*` and reviewed.

Important options:

| Option | Purpose |
| --- | --- |
| `--migrate`, `--adopt-existing` | Preserve an existing wiki as `wiki_legacy*`, create migration inboxes, and generate unit-map/split-plan/coverage review files. |
| `--lint` | Validate generated setup without editing files. |
| `--link-check` | Report broken wiki links, duplicate routes, orphan pages, and pages the startup router cannot reach within the depth budget. |
| `--quality-check` | Report stale, conflicting, and low-quality wiki document signals. |
| `--doctor` | Run lint, link-check, and quality-check together. |
| `--doctor --fix` | Safely refresh generated index routing before diagnostics. |
| `--migration-lint` | Validate migration coverage, unit-map, split-plan, and review scaffolding separately from normal lint. |
| `--migration-quality-check` | Report migration policy/structure signals separately from normal quality-check. |
| `--migration-doctor` | Run migration-lint and migration-quality-check together. |
| `--query <terms>` | Search wiki paths, metadata, titles, and bodies; answer-first output with per-page TL;DR lines under a hard size cap. |
| `--wiki-impact <page-or-term>` | Show wiki backlinks, `decision_ref` citations, outgoing links, and router depth for matching pages. |
| `--wiki-visualize` | Write a self-contained static wiki graph visualizer to `.project-wiki/wiki-graph.html`. |
| `--wiki-visualize-out <path>` | With `--wiki-visualize`, write to a custom repository-relative path under `.project-wiki/`. |
| `--refresh-index` | Update generated auto-discovered wiki routing. |
| `--capture-inbox --title <title> --content <content>` | Append a candidate note to the wiki inbox. |
| `--issue-draft --issue-title <title>` | Print a read-only GitHub issue body draft for problems or side effects. |
| `--issue-create --issue-title <title>` | Create a GitHub issue through `gh` after explicit user approval. |
| `--glossary-init` | Create and route the optional glossary page. |
| `--prune-check` | Report active pages with stale or unresolved lifecycle signals. |
| `--review-migration`, `--semantic-migrate` | Sync migration coverage and inbox statuses into migration review files. |
| `--no-git-config` | Install hook files without changing `git core.hooksPath`. |
| `--code-index` | Build the disposable code evidence index. |
| `--code-report` | Print architecture and ownership summaries from the evidence index. |
| `--code-report-section <section>` | Print one section: `coverage`, `ownership`, `languages`, `parsers`, `workspaces`, `workspace-graph`, `routes`, `hotspots`, `configs`, or `edges`. |
| `--code-impact <term>` | Show file, symbol, route, import, edge, and owner impact evidence. |
| `--code-context-pack <term>` | Print a budgeted first-pass context pack with structural file, symbol, route, import, edge, and ownership evidence. |
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
