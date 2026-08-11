# Usage

## Install the Reusable Skill

```bash
npx project-librarian@latest install
```

The installer asks where to install the skill and which agent surfaces to enable. Use the arrow keys to choose a scope, then use `Space` to check agents and `Enter` to install. Use `--scope user|project` and `--agents codex,claude,cursor,gemini|all` when running non-interactively.

## Initialize a Repository

```bash
npx project-librarian@latest init
```

Initialization creates neutral service/PRD hubs, operating rules, compact startup routing, agent hooks, and Git hook files. It does not invent services or PRDs and does not overwrite an existing wiki.

To target selected agent surfaces:

```bash
npx project-librarian@latest init --agents codex,cursor
```

Use `--no-git-config` when hook files are wanted but the repository's `core.hooksPath` must not change.

## Update an Existing Setup

```bash
npx project-librarian@latest update
```

Update refreshes managed instructions, hooks, operating templates, and installed project-scope skill copies. It preserves existing wiki documents and targets managed or already-present agent surfaces unless `--agents` is explicit. If no installation or agent root can be detected, it fails before writing and asks for `init` or an explicit agent selection.

Existing lifecycle-style directories are left in place as read-only compatibility material. Project Librarian does not automatically reorganize them.

## Organize the Wiki

The primary write route is:

```text
service -> PRD/initiative -> document area -> focused artifact
```

- Register services and stable PRD IDs through `wiki/00-index/`.
- Store service and PRD truth under `wiki/10-services/`.
- Use `wiki/20-shared/` only for genuinely shared contracts.
- Use `wiki/30-portfolio/` for cross-PRD sequencing.
- Put unresolved candidates in `wiki/inbox/`.
- Retire recoverable material under `wiki/90-archive/`.

Every durable page should state its status, update date, scope, type, owner, reading budget, decision reference, and review trigger.

## Search and Follow Routes

```bash
project-librarian --query "rate limit policy"
project-librarian --wiki-impact "PRD-012"
project-librarian --wiki-neighborhood "checkout"
```

`--query` returns the strongest matching page and bounded supporting results. `--wiki-impact` explains links and citations around a target. `--wiki-neighborhood` proposes a small read order around a target.

## Check Wiki Quality

```bash
project-librarian --lint
project-librarian --link-check
project-librarian --quality-check
project-librarian --doctor
```

Use `--doctor --fix` to refresh the managed index block before running diagnostics. Use `--prune-check` or `--prune-check-strict` to identify pages that need review or retirement.

## Inbox and Glossary

```bash
project-librarian --capture-inbox \
  --title "Retry ownership" \
  --content "Confirm which service owns retry policy." \
  --category open-question

project-librarian --glossary-init
project-librarian --refresh-index
```

Inbox entries remain candidates until a human or agent classifies them into the owning service, PRD, shared, portfolio, or archive route.

## Session Handoff

```bash
project-librarian --handoff-save \
  --goal "Finish checkout requirements" \
  --state "Draft complete" \
  --next "Review with payments owner" \
  --verification "project-librarian --doctor"

project-librarian --handoff-show
project-librarian --handoff-status
project-librarian --handoff-promote-inbox
project-librarian --handoff-clear
```

Handoff files are generated local reference data, not durable planning truth. Promote only selected facts to the inbox, then classify them normally.

## Common Agent Requests

| Outcome | Request |
| --- | --- |
| Fresh setup | “Initialize Project Librarian and organize the project wiki.” |
| Refresh setup | “Update Project Librarian while preserving the existing wiki.” |
| Diagnose quality | “Run the Project Librarian wiki doctor and explain actionable findings.” |
| Find project truth | “Search the project wiki for the authentication policy and follow the owning route.” |
| Capture a candidate | “Save this open question to the Project Librarian inbox.” |
| Resume work | “Show the latest Project Librarian handoff and continue the unfinished work.” |
