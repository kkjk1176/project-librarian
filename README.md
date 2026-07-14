# Project Librarian

[![npm version](https://img.shields.io/npm/v/project-librarian.svg?cacheSeconds=300)](https://www.npmjs.com/package/project-librarian)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.13-brightgreen.svg)](https://nodejs.org/)
[![Code evidence index](https://img.shields.io/badge/code%20evidence-node%3Asqlite-blue.svg)](https://nodejs.org/api/sqlite.html)

**Give every AI coding agent the same durable memory of your project.** Project Librarian keeps a compact, repo-local planning wiki, plus an optional code-evidence index, that Codex, Claude Code, Cursor, and Gemini CLI can read at session start.

Languages: [English](README.md) | [한국어](README.ko.md)

## Quick Start

Most users should ask their coding agent to run Project Librarian rather than run lifecycle commands by hand.

Install the reusable skill files once:

```bash
npx project-librarian@latest install --scope user --agents all
```

Then ask Codex, Claude Code, Cursor, or Gemini CLI from the target repository:

- "Use Project Librarian to set up this repository's planning wiki and run diagnostics."
- "Use Project Librarian to migrate the existing docs/wiki content."
- "Search the Project Librarian wiki for authentication decisions."

The installed skill resolves the local runner and executes the right command from the project root. Use a project-local install only when you want the runner stored inside that repository's agent setup:

```bash
npx project-librarian@latest install --scope project --agents all
```

`install` copies reusable runner and skill files plus required local-runner runtime dependencies. The agent-run lifecycle command creates or updates `AGENTS.md`, agent hooks, `wiki/`, git hook files, diagnostics, and optional code-evidence support. `install-skill` remains a compatibility alias.

## Update

To refresh an existing setup without migrating the wiki, run:

```bash
npx project-librarian@latest update
```

That updates managed setup files, agent hooks, wiki operating/meta files, and existing project-scoped skill copies. Existing shared `.agents/skills/project-librarian/` copies are refreshed without implying any agent-specific setup surface. A plain update preserves managed surfaces; when no managed surface exists yet, it targets only agent roots already present such as `.codex/` or `.cursor/`. It does not create unrelated agent directories. If neither an existing Project Librarian install nor an agent root can be detected, update stops before writing and asks for `init` or an explicit `--agents` selection. It preserves the current `wiki/` and rejects migration flags, so it will not rename the wiki to `wiki_legacy*`.

Use `--agents` when you intentionally want to add or refresh a specific project surface:

```bash
npx project-librarian@latest update --agents cursor
npx project-librarian@latest update --agents all
```

User-scoped skill installs are global agent tooling and are not changed by a project update. Refresh them explicitly:

```bash
npx project-librarian@latest install --scope user --agents all
```

## Why It Exists

LLM coding agents waste context and tool calls when every session starts by rediscovering the project: reading old chats, scanning markdown, grepping source, and guessing which files matter.

Project Librarian gives agents a small first read and reliable routes to deeper truth:

| Surface | What It Gives The Agent |
| --- | --- |
| `wiki/startup.md` + `wiki/index.md` | A compact session-start summary and router, so only relevant planning pages are read. |
| `wiki/canonical/`, `wiki/roadmaps/`, `wiki/plans/`, `wiki/decisions/` | Current truth, future scope, execution plans, and durable rationale stay separated. |
| Agent hooks and rules | Codex, Claude Code, Cursor, and Gemini CLI start from the same wiki-first contract. |
| `.project-wiki/code-evidence.sqlite` | Optional, regenerable code evidence for impact, ownership, routes, symbols, imports, and workspace graph questions. |
| Diagnostics and migration modes | Link checks, quality checks, migration review files, stale-signal reports, and issue drafts. |

The core idea is not "write more docs." It is "keep the first agent read small, then give it reliable routes to deeper project truth and code evidence."

## Highlights

- **Small first read.** Startup hooks inject only `wiki/startup.md` and `wiki/index.md`; agents route to deeper pages on demand.
- **One setup, four agents.** Codex, Claude Code, Cursor, and Gemini CLI share the same repo-local memory contract.
- **Structured wiki writing.** New project content is classified before it is written or consolidated, so PRDs, policies, UX, data, APIs, QA, release, and operations notes do not collapse into one catch-all page.
- **Measured claims.** Benchmark wins and losses are published together, with claim boundaries attached.
- **Local session handoff.** `--handoff-save` stores generated resume notes under `.project-wiki/session/` without turning execution memory into canonical project truth.
- **Answer-shaped wiki topology.** `--wiki-impact`, `--wiki-neighborhood`, and topology diagnostics expose backlinks, decision evidence, router depth, and nearby read order without a graph visualizer.
- **Optional code evidence.** A SQLite index plus answer-shaped MCP tools answer expensive traversal questions on large repositories without adding an MCP SDK dependency.
- **Safe to re-run.** Bootstrap is idempotent and preservation-first.

## Common Requests

Ask your agent for the outcome you want; the installed skill maps the request to the local runner.

| Goal | Ask The Agent |
| --- | --- |
| Create or update the wiki | "Use Project Librarian to set up or update this repository's planning wiki." |
| Update without migration | "Update this repository's Project Librarian setup without migrating the wiki." |
| Migrate existing docs/wiki content | "Use Project Librarian to migrate the existing docs/wiki content." |
| Run diagnostics | "Run Project Librarian diagnostics." |
| Search project memory | "Search the Project Librarian wiki for authentication decisions." |
| Find nearby wiki context | "Show Project Librarian wiki neighborhood for canonical/project-brief." |
| Build code evidence | "Build Project Librarian code evidence for `src`." |
| Inspect code impact | "Show Project Librarian impact evidence for `healthHandler`." |
| Save a handoff | "Save a Project Librarian session handoff for the current work." |

See [Usage](docs/usage.md) for install scopes, runner paths, generated files, migration behavior, and the full agent-request table.

## Benchmarks

These numbers are maintainer release evidence, not a blanket promise. Every value is real Codex JSONL usage and local wall-clock time, measured hermetically against an `organic` control with no Project Librarian. The wiki-routing track and the code-graph track are measured separately; a win on one never backs a claim about the other.

Latest clean synthetic wiki-routing track release evidence: 2026-06-29, `gpt-5.5`, branch `perf/small-repo-code-evidence-safeguards` at `ae79390`, 42 scenarios, 21 with/without pairs, 3 measured runs plus 1 warmup each. The overall claim gate **passed**, and the claim ledger classified the report as release-claimable. A repair run reused 125 claimable measured runs from retained raw JSONL and remeasured the remaining failed slot. This is bounded to the synthetic wiki-routing track and listed task families; it is not a claim about code-graph behavior, real repositories, every agent surface, or every question shape.

Wiki track aggregate deltas vs control:

| Scale | Cost-weighted tokens | Total tokens | Wall time | Commands | Tool output |
| --- | ---: | ---: | ---: | ---: | ---: |
| All | 51.39% less | 48.67% less | 19.83% less | 18.40% less | 85.88% less |
| Small | 21.59% less | 9.31% less | 13.91% less | 12.64% less | 43.89% less |
| Medium | 45.95% less | 37.42% less | 11.88% less | 4.30% less | 69.12% less |
| Large | 66.97% less | 69.87% less | 31.90% less | 35.19% less | 95.58% less |

Wiki track task-family cost-weighted token deltas vs control, all scales combined:

| Task family | Delta |
| --- | ---: |
| onboarding | 65.95% less |
| decision_lookup | 48.46% less |
| code_impact | 55.61% less |
| release_policy | 58.22% less |
| change_location | 29.59% less |
| multi_session | 52.58% less |
| aggregation | 42.53% less |

Scale-specific values vary; see [Benchmark Evidence](docs/benchmarks.md#wiki-track) for the small/medium/large task-family matrix and the cells that still regress.

Timing and command-count caveat: `code_impact`, `change_location`, and `aggregation` still had wall-time or command-count regressions in this report, even though token and output-byte metrics improved for every task family.

Code-graph track, cost-weighted tokens vs control:

| Question | excalidraw (~1.2k files) | backstage (~11.8k files) |
| --- | --- | --- |
| impact_trace | 117% more | **27.7% less** |
| workspace_graph | 106% more | 2.6% less |
| ownership_lookup | - | 99% more |

The code-evidence index pays off only on genuinely large repositories for expensive traversal questions. Below ~5k indexable files, `--code-index` halts unless `--acknowledge-small-repo` is passed, and bootstrap skips MCP auto-registration unless an existing `.project-wiki` SQLite index shows the user already opted in.

Before citing `--code-report`, `--code-impact`, `--code-context-pack`, or MCP tool output as current code-structure evidence, run `project-librarian --code-status` or MCP `code_status` and require `stale_files: 0`. Stale reports are pointers for rebuild, not authoritative project truth.

See [Benchmark Evidence](docs/benchmarks.md) for methodology, task-family definitions, reproduction commands, and the published losses.

## Documentation

| Document | Use It For |
| --- | --- |
| [Usage](docs/usage.md) | Install scopes, runner paths, generated files, migration, and common agent requests. |
| [Code Evidence](docs/code-evidence.md) | MCP server behavior, freshness contract, scale gate, language support, and native helper policy. |
| [CLI Reference](docs/cli-reference.md) | Complete command and option reference. |
| [Benchmark Evidence](docs/benchmarks.md) | Public benchmark claims, limits, and maintainer benchmark commands. |
| [Maintainer Guide](docs/maintainer.md) | Development, release readiness, trusted publishing, and benchmark operations. |
| [Contributing](CONTRIBUTING.md) | Local contribution workflow and verification expectations. |
| [Security Policy](SECURITY.md) | Supported versions, private reporting, and supply-chain boundary. |

## Install Details

| Situation | Command |
| --- | --- |
| Install globally for all supported agents | `npx project-librarian@latest install --scope user --agents all` |
| Install in the current repository | `npx project-librarian@latest install --scope project --agents all` |
| Install only Codex | `npx project-librarian@latest install --agents codex` |
| Install only Claude Code | `npx project-librarian@latest install --agents claude` |
| Install only Cursor | `npx project-librarian@latest install --agents cursor` |
| Install only Gemini CLI | `npx project-librarian@latest install --agents gemini` |
| Preview install output | `npx project-librarian@latest install --scope project --agents all --dry-run` |

`--agents` also accepts comma-separated values such as `codex,claude,cursor,gemini`. `all` targets every supported agent. `--scope` accepts `user` or `project`. Direct CLI and automation details are in [CLI Reference](docs/cli-reference.md).

## Inspiration

This project is inspired by Andrej Karpathy's [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) pattern: keep persistent markdown context close to the work instead of reconstructing project state from long chat history.

Project Librarian adapts that idea into an installable CLI and skill for Codex, Claude Code, Cursor, and Gemini CLI, with repo-local instructions, compact startup hooks, migration helpers, diagnostics, and optional code evidence.

## License

MIT
