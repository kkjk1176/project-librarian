# Project Wiki Bootstrap

Bootstrap a token-efficient project planning wiki for humans and LLM agents.

Languages: [English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [简体中文](README.zh.md)

The generated wiki keeps startup context small by loading only:

- `wiki/startup.md`: compact current project context
- `wiki/index.md`: router for detailed files to read next

Detailed canonical, decision, meta, and source files are read on demand only when the current task needs them.

## Table of Contents

- [Quick Start](#quick-start)
- [Skill Actions](#skill-actions)
- [Using The Skill](#using-the-skill)
- [What Gets Installed](#what-gets-installed)
- [Generated Wiki Model](#generated-wiki-model)
- [How It Works](#how-it-works)
- [Policies And Side Effects](#policies-and-side-effects)
- [Development](#development)
- [License](#license)

## Quick Start

Use `npx` only for initial installation and bootstrap. After that, use the installed skill through Codex or Claude Code.

User-level install, available across projects:

```bash
npx project-wiki-bootstrap install-skill --scope user --agents both
npx project-wiki-bootstrap
```

Project-level install, shared with one repository:

```bash
npx project-wiki-bootstrap install-skill --scope project --agents both
npx project-wiki-bootstrap
```

Existing wiki/docs migration:

```bash
npx project-wiki-bootstrap --migrate
```

Install hook files without changing git config:

```bash
npx project-wiki-bootstrap --no-git-config
```

Use `--agents codex` or `--agents claude` instead of `--agents both` when installing for only one agent.

## Skill Actions

Installing this package adds one skill, `project-wiki-bootstrap`, to Codex and/or Claude Code. That skill supports these project wiki actions:

- Bootstrap or update: create or refresh `AGENTS.md`, `CLAUDE.md`, `wiki/`, Codex hooks, Claude Code hooks, and git hook files.
- Validate: check required files, metadata headers, routing, hook setup, executable bits, and git hook configuration.
- Search: find relevant wiki pages by path, title, metadata, and body text.
- Refresh index: update the auto-discovered page block in `wiki/index.md`.
- Capture candidate: save a note into `wiki/inbox/project-candidates.md` without making it canonical truth.
- Prune check: report active wiki pages that look pending, stale, proposed, or undecided.
- Glossary init: create `wiki/canonical/glossary.md` when project terminology needs a canonical home.
- Migration: move an existing wiki aside, create a clean wiki, inventory legacy markdown, and write migration inboxes.
- Migration review: sync processed migration inbox status into review and verification pages.
- No-git-config setup: install hook files without changing `core.hooksPath`.

## Using The Skill

Once installed, use natural language in Codex:

- "Apply project-wiki-bootstrap to this project."
- "Validate the project wiki setup."
- "Search the project wiki for authentication decisions."
- "Refresh the wiki index."
- "Capture this as a project wiki candidate."
- "Review the migrated wiki inbox."

In Claude Code, invoke the skill directly or use natural language:

- `/project-wiki-bootstrap`
- "Initialize the project wiki."
- "Check whether the project wiki is healthy."
- "Find wiki notes about release risks."

The skill maps these requests to the appropriate lifecycle operation internally. The project wiki and hooks are still created only when bootstrap runs in a project root.

## What Gets Installed

Project instruction files:

- `AGENTS.md`: compact project-wide wiki-first instructions
- `CLAUDE.md`: Claude Code compatibility file that imports `AGENTS.md`
- `wiki/AGENTS.md`: detailed wiki-internal editing rules

Startup hooks:

- `.codex/hooks.json`: Codex `SessionStart` hook registration
- `.codex/hooks/wiki-session-start.js`: compact startup context injector
- `.claude/settings.json`: Claude Code `SessionStart` hook registration
- `.claude/hooks/wiki-session-start.js`: compact startup context injector for Claude Code

Git hook files:

- `.githooks/prepare-commit-msg`: optional git commit hook entrypoint
- `.githooks/wiki-commit-trailers.js`: wiki commit trailer generator

Wiki files and directories:

- `wiki/startup.md`: session-start summary
- `wiki/index.md`: routing index with read/update/token-budget hints
- `wiki/canonical/`: current project truth
- `wiki/decisions/`: project decision history
- `wiki/meta/`: wiki operating rules and decision policy
- `wiki/sources/`: source summaries
- `wiki/inbox/`: captured candidates that are not yet canonical truth
- `wiki/migration/`: generated migration inventory, plan, verification, and review state

This project is independent of external orchestration layers. It does not create project memory files for any orchestration framework.

## Generated Wiki Model

- `wiki/startup.md`: compact session-start summary and project state.
- `wiki/index.md`: router that tells humans and agents which detailed files to read or update.
- `wiki/canonical/`: current project truth, such as brief, assumptions, risks, open questions, and optional glossary.
- `wiki/decisions/`: project decision history, recent decisions, Decision Pack template, and Full ADR template.
- `wiki/meta/`: wiki operating model, decision policy, bootstrap decisions, language policy, lint and migration rules.
- `wiki/sources/`: source summaries and references that informed the wiki.
- `wiki/inbox/`: captured candidates that are not yet canonical truth.
- `wiki/migration/`: generated migration inventory, plan, verification, and review state.

## How It Works

LLM coding agents are most useful when they can quickly recover current project intent, decisions, assumptions, and risks without rereading long chat history or loading a large documentation tree.

This project creates a small, durable wiki structure that separates always-useful routing context from detailed project knowledge. It does not replace product docs, architecture docs, or issue trackers; it gives humans and agents a low-token project-planning source of truth that stays close to the repository.

Core design points:

- Token-efficient startup context: only `wiki/startup.md` and `wiki/index.md` are intended for initial context.
- Read On Demand routing: detailed canonical docs, decisions, source notes, migration pages, and meta docs are read only when needed.
- Project truth separation: current project truth lives in `wiki/canonical/`; rationale and history live in `wiki/decisions/`; wiki operating rules live in `wiki/meta/`.
- Agent instruction support: generates compact project-level instructions for Codex and Claude Code.
- Codex and Claude Code startup hooks: registers `SessionStart` hooks that inject compact wiki startup context into both tools.
- Git commit trailers: installs an optional `prepare-commit-msg` hook that records wiki impact in commit trailers.
- Idempotent bootstrap: rerunning the script updates managed operating files while preserving starter project wiki pages.
- npx-first skill installation: installs Codex and Claude Code skill wrappers to user or project scope without requiring a global npm install.

Typical workflow:

1. Bootstrap the wiki in a project.
2. At session start, read `wiki/startup.md` and `wiki/index.md`.
3. Read detailed wiki pages only when the current task needs them.
4. When project planning content changes, update the relevant canonical, decision, source, or meta page in the same turn.
5. Ask Codex or Claude Code to validate, search, refresh, capture, or migrate the wiki through the installed skill.
6. Let the generated git hook append wiki trailers when committing wiki-related changes.

This project is inspired by Andrej Karpathy's [LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) pattern: a persistent markdown wiki maintained with LLM help, instead of repeatedly reconstructing context from raw documents or chat history.

## Policies And Side Effects

Git side effect:

- In a git repository, bootstrap configures `git config core.hooksPath .githooks` by default.
- Use `npx project-wiki-bootstrap --no-git-config` to install hook files without changing `core.hooksPath`.
- If a project already uses another `core.hooksPath`, review before running or reset the git config afterward.

File preservation:

- Existing `AGENTS.md`, `CLAUDE.md`, and `wiki/AGENTS.md` files are not overwritten wholesale.
- Bootstrap appends its marker-bounded project-wiki section when no managed section exists.
- On rerun, bootstrap replaces only the content between its own `PROJECT-WIKI-*` markers and preserves surrounding project-specific content.

Language policy:

- This repository README is English by default for GitHub distribution.
- Localized documentation is available in [Korean](README.ko.md), [Japanese](README.ja.md), and [Simplified Chinese](README.zh.md).
- Generated operating documents are English by default, including root `AGENTS.md`, `wiki/AGENTS.md`, `wiki/startup.md`, `wiki/index.md`, migration operating pages, and wiki meta pages.
- Project canonical wiki content does not default to Korean or English. The LLM should choose the language from explicit user instruction, existing project language, source documents, and team context. When no signal exists, prefer the language already used in the current interaction or repository.

Agent compatibility:

- Codex reads `AGENTS.md` and uses `.codex/hooks/wiki-session-start.js` for compact startup context.
- Claude Code reads `CLAUDE.md`, not `AGENTS.md`, and uses `.claude/hooks/wiki-session-start.js` for the same compact startup context.
- The generated `CLAUDE.md` imports `AGENTS.md` with `@AGENTS.md`, keeping project-wide rules in one place.

## Development

The source is TypeScript and the committed `dist/` directory is the compiled JavaScript used by npm bin and skill installations.

Repository layout:

- `src/init-project-wiki.ts`: CLI entrypoint and top-level orchestration.
- `src/args.ts`: command-line argument parsing and mode flags.
- `src/types.ts`: shared TypeScript contracts for statuses, migration rows, hook config, query results, and prune candidates.
- `src/workspace.ts`: repository-relative filesystem helpers, markdown metadata helpers, executable bits, and common command checks.
- `src/hooks.ts`: Codex and Claude Code `SessionStart` hook generation, git hook generation, and git hook configuration.
- `src/install-skill.ts`: npx-driven user/project skill installer for Codex and Claude Code.
- `src/templates.ts`: generated `AGENTS.md`, `CLAUDE.md`, wiki starter pages, wiki meta pages, and source summary templates.
- `src/wiki-files.ts`: wiki file discovery, markdown table parsing, wiki link helpers, metadata summaries, and marked-section preservation.
- `src/migration.ts`: existing wiki migration, migration inboxes, migration verification, and semantic review sync.
- `src/modes.ts`: lifecycle commands such as `--lint`, `--query`, `--refresh-index`, `--capture-inbox`, and `--prune-check`.
- `dist/`: build output committed for zero-build execution.

Development commands:

```bash
npm install
npm run typecheck
npm run build
npm test
npm pack --dry-run
```

When editing TypeScript files under `src/`, rebuild before committing so the matching `dist/` files stay current.

## License

MIT
