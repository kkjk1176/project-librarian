# Project Librarian

[![npm](https://img.shields.io/npm/v/project-librarian.svg)](https://www.npmjs.com/package/project-librarian)
[![license](https://img.shields.io/npm/l/project-librarian.svg)](LICENSE)

**Give coding agents a durable, well-organized view of the project.** Project Librarian creates and maintains a repository-local planning wiki for Codex, Claude Code, Cursor, and Gemini CLI.

The wiki is organized by ownership: `service -> PRD/initiative -> document area`. Compact startup pages route agents to current truth, decisions, sources, plans, shared contracts, and archived material only when needed.

## Install

```bash
npx project-librarian@latest install --scope user --agents all
```

Then ask an agent:

> Initialize Project Librarian in this repository and organize the project wiki.

Or run the CLI directly:

```bash
npx project-librarian@latest init
```

`init` creates missing wiki and agent setup files without replacing an existing `wiki/`. `update` refreshes managed setup while preserving existing wiki content and agent surfaces.

```bash
npx project-librarian@latest update
```

## What It Creates

| Path | Purpose |
| --- | --- |
| `wiki/startup.md` | Compact session-start context. |
| `wiki/index.md` | Writable router into the rest of the wiki. |
| `wiki/00-index/` | Service map and PRD registry. |
| `wiki/10-services/` | Service truth and PRD-owned documents. |
| `wiki/20-shared/` | Cross-service contracts and glossary. |
| `wiki/30-portfolio/` | Cross-PRD sequencing and roadmap work. |
| `wiki/90-archive/` | Retired material kept for reference. |
| `wiki/meta/` | Wiki taxonomy and operating rules. |
| Agent hooks and instructions | Startup routing for selected coding agents. |

Existing lifecycle-style wiki directories remain untouched as read-only compatibility material. Project Librarian does not automatically restructure them.

## Wiki Workflows

```bash
project-librarian --lint
project-librarian --link-check
project-librarian --quality-check
project-librarian --doctor
project-librarian --query "authentication policy"
project-librarian --wiki-impact "PRD-012"
project-librarian --wiki-neighborhood "checkout"
project-librarian --refresh-index
project-librarian --glossary-init
project-librarian --capture-inbox --title "Open question" --content "Who owns billing retries?"
```

Local session handoff commands preserve short-lived resume context under `.project-wiki/session/` without treating it as durable wiki truth.

## Design Principles

- Organization quality comes first: every durable page has a clear owner, scope, status, and route.
- Startup context stays compact; detail is read on demand through explicit links.
- Existing wiki content is preserved by default.
- Candidate notes stay in `wiki/inbox/` until reviewed.
- Diagnostics warn about broken links, weak routing, stale pages, and overloaded hubs.

## Documentation

| Guide | Contents |
| --- | --- |
| [Usage](docs/usage.md) | Setup, generated files, wiki workflow, and agent requests. |
| [CLI reference](docs/cli-reference.md) | Commands and options. |
| [Maintainer guide](docs/maintainer.md) | Development, verification, packaging, and publishing. |
| [한국어 README](README.ko.md) | Korean introduction and usage. |

## Requirements

- Node.js 22.13 or newer
- Git is optional; existing `core.hooksPath` settings are preserved

## License

[MIT](LICENSE)
