# Project Librarian

[![npm](https://img.shields.io/npm/v/project-librarian.svg)](https://www.npmjs.com/package/project-librarian)
[![license](https://img.shields.io/npm/l/project-librarian.svg)](https://github.com/kkjk1176/project-librarian/blob/main/LICENSE)

**Keep your project context easy to find.** Project Librarian sets up a repository-local planning wiki so Codex, Claude Code, Cursor, and Gemini CLI can find current truth, decisions, and next steps without loading everything at once.

The wiki follows `service → PRD/initiative → document area → focused artifact`, keeping each detail close to its owner.

## Start here

Install the reusable skill, then initialize the current repository:

```bash
npx project-librarian@latest install
npx project-librarian@latest init
```

When the install command runs in a terminal, it lets you choose the install scope and agent surfaces. In automation, pass `--scope` and `--agents` explicitly.

Then ask your agent:

> Initialize Project Librarian in this repository and organize the project wiki.

Already have a setup? Refresh it with:

```bash
npx project-librarian@latest update
```

`init` preserves an existing `wiki/`. `update` refreshes selected skills and agent setup/hooks; it does not create or rewrite the project wiki. See the [usage guide](https://github.com/kkjk1176/project-librarian/blob/main/docs/usage.md) for the exact scope and target rules.

## What you get

| Path | Purpose |
| --- | --- |
| `wiki/startup.md` | A compact summary for the start of a session. |
| `wiki/index.md` | The main route into the rest of the wiki. |
| `wiki/00-index/` | Service map and PRD registry. |
| `wiki/10-services/` | Service truth and PRD-owned documents. |
| `wiki/20-shared/` | Shared contracts and terminology. |
| `wiki/30-portfolio/` | Cross-PRD priorities and sequencing. |
| `wiki/90-archive/` | Retired material kept for reference. |
| Selected agent setup and hooks | Startup routing for the agents you choose. |

Existing lifecycle-style directories stay in place as read-only compatibility material. Project Librarian does not reorganize them automatically.

## A few useful commands

```bash
project-librarian --query "authentication policy"
project-librarian --wiki-impact "PRD-012"
project-librarian --wiki-neighborhood "checkout"
project-librarian --doctor
```

Use the [CLI reference](https://github.com/kkjk1176/project-librarian/blob/main/docs/cli-reference.md) for inbox capture, index refresh, glossary setup, session handoff, and every available option.

## Read next

| Guide | When to open it |
| --- | --- |
| [Usage](https://github.com/kkjk1176/project-librarian/blob/main/docs/usage.md) | Install, initialize, update, and organize a wiki. |
| [PRD visual artifacts](https://github.com/kkjk1176/project-librarian/blob/main/docs/prd-visual-artifacts.md) | Create accessible, self-contained HTML visuals for PRDs. |
| [CLI reference](https://github.com/kkjk1176/project-librarian/blob/main/docs/cli-reference.md) | Look up commands and options. |
| [Maintainer guide](https://github.com/kkjk1176/project-librarian/blob/main/docs/maintainer.md) | Develop, verify, package, and publish the project. |
| [한국어 README](https://github.com/kkjk1176/project-librarian/blob/main/README.ko.md) | Read the same overview in Korean. |

## Requirements

- Node.js 22.13 or newer
- Git is optional; use `--no-git-config` when hook files are needed without changing `core.hooksPath`

## License

[MIT](https://github.com/kkjk1176/project-librarian/blob/main/LICENSE)
