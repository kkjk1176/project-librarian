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

In a TTY, update first asks for a scope. Project scope then asks for update targets; user scope immediately updates the installed user skill without a second prompt:

- `user`: refresh installed user-scope skill copies only. It never writes the current project's wiki, agent instructions, or hooks.
- `project`: check any combination of reusable skill copies and project agent setup/hooks. Update does not write the project wiki.

For non-interactive automation, use explicit selections such as:

```bash
npx project-librarian@latest update --scope user --targets skill --agents codex
npx project-librarian@latest update --scope project --targets skill,agents --agents codex,cursor --no-git-config
```

`--targets` accepts `skill`, `agents`, or `all`. Existing project-scope skill copies are refreshed only when the skill target is selected; missing project-scope skill copies are not created by update. The agents target requires an existing agent root unless `--agents` explicitly selects one. Use `init` for missing wiki setup and explicit wiki maintenance options such as `--refresh-index` for wiki changes.

Existing lifecycle-style directories are left in place as read-only compatibility material. Project Librarian does not automatically reorganize them.

## PRD Visual Artifacts

PRDs support the complete set of visual artifacts below. When one is needed, write the canonical visual as an HTML file and link it from the owning Markdown page or area index.

| Area | Visual artifacts |
| --- | --- |
| Discovery | Journey map; ecosystem and stakeholder map |
| Requirements | User flow; service blueprint/swimlane; permission matrix |
| Design | System context/architecture; sequence diagram; state machine; screen flow/wireframes; domain/data model |
| Delivery/Roadmap | Dependency and rollout map |
| Validation/Metrics | Experiment flow; funnel; KPI tree; cohort view |
| Decisions/Sources | Decision-impact map; evidence map |

Use this layout under the owning PRD:

```text
wiki/10-services/<service>/prds/<PRD-ID-slug>/03-design/
  index.md
  visuals/
    system-architecture.html
    state-machine.html
```

Markdown remains the source of truth for metadata, rationale, requirements, decisions, and text summaries. HTML is the source for the visual presentation. Each visual must be self-contained, responsive, printable, keyboard-navigable, accessible without color alone, and include a title, purpose, legend, text summary, updated date, and source or decision references. Mermaid or ASCII diagrams may be used for small inline explanations, but the canonical PRD visual must be HTML. See [PRD visual artifact guidance](prd-visual-artifacts.md) for the full contract.

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
