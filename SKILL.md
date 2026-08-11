---
name: project-librarian
description: Bootstrap, update, validate, search, and organize a service- and PRD-centered project planning wiki.
metadata:
  short-description: Service/PRD planning wiki
---

# Project Librarian

Use this skill to operate a compact, durable planning wiki in the current project. Resolve and run the local Project Librarian runner yourself; ask users for outcomes rather than CLI flags unless they explicitly request shell commands.

## Wiki contract

The durable route is `service -> PRD/initiative -> document area -> focused artifact`.

```text
wiki/
  00-index/                 service map and PRD registry
  01-governance/            source-of-truth and writing rules
  10-services/<service>/    service truth and PRD hubs
  20-shared/                cross-service contracts and glossary
  30-portfolio/             cross-PRD sequencing and roadmap
  90-archive/               retired recoverable material
  inbox/  indexes/  meta/
```

- Fresh `init` creates neutral common hubs; it never invents a service or PRD.
- `update` leaves existing wiki content untouched and refreshes only managed skill or agent setup.
- New product, decision, evidence, and planning writes use `10-services/`, `20-shared/`, or `30-portfolio/`.
- Existing lifecycle roots are read-only compatibility material. Do not create new content there.
- Keep unreviewed material in `wiki/inbox/` and wiki operating rules in `wiki/meta/`.
- Every durable page declares status, updated date, scope, type, owner, read budget, decision reference, and review trigger.

## PRD visual artifacts

PRD visual elements are first-class HTML artifacts. Support the complete visual set when the PRD needs it:

- discovery: journey map and ecosystem/stakeholder map;
- requirements: user flow, service blueprint/swimlane, and permission matrix;
- design: system context/architecture, sequence diagram, state machine, screen flow/wireframes, and domain/data model;
- delivery and roadmap: dependency and rollout map;
- validation and metrics: experiment flow, funnel, KPI tree, and cohort view;
- decisions and sources: decision-impact and evidence map.

Store each artifact under the owning PRD area, for example `wiki/10-services/<service>/prds/<PRD-ID-slug>/03-design/visuals/system-architecture.html`. Keep the Markdown PRD page or area index as the canonical metadata and narrative route, and link the HTML artifact from it. The visual itself must be HTML; Mermaid or ASCII diagrams may explain a small point in Markdown but are not the canonical visual artifact.

Every HTML visual must be self-contained, responsive, printable, keyboard-navigable, and understandable without color alone. Include a title, purpose, legend, text summary or accessible equivalent, source/decision references, and an updated date. Avoid external CDN dependencies; use inline CSS/SVG or repository-local assets. Update the visual and its Markdown route together when the underlying product decision changes.

## Supported work

- Initialize, update, install, or synchronize the wiki, agent instructions, hooks, and reusable skill copies.
- Create and maintain the full set of PRD visual artifacts as linked, accessible HTML files.
- Diagnose required files, metadata, links, duplicate routes, orphan pages, topology, staleness, and document quality.
- Search wiki content and inspect impact or neighborhood routes.
- Refresh the index, capture inbox candidates, initialize the glossary, and find pages needing review.
- Save, inspect, promote, inject, or clear local session handoff state under `.project-wiki/session/`.
- Draft an issue body when the runner and this contract diverge.

## Workflow

1. Resolve a local runner from the project root. Prefer `node dist/init-project-wiki.js` in this source repository, then `.agents/skills/project-librarian/dist/init-project-wiki.js`, then an installed project-scoped copy.
2. Read `wiki/startup.md` and `wiki/index.md`, then follow the owning service, PRD hub, shared area, portfolio route, or compatibility page only as needed.
3. Classify planning material using `wiki/meta/document-taxonomy.md`: owner first, then service, PRD, document area, lifecycle state, and current/future/decision/evidence role.
4. Update the narrowest focused artifact and its relevant hub or registry. For PRD visuals, choose the owning document area, write the visual as HTML, and link it from the Markdown route. Do not use a hub as a catch-all document.
5. Preserve existing wiki content. Retire obsolete material only when its replacement and recovery route are clear.

| Request | Command |
| --- | --- |
| Fresh setup | `init` |
| Existing setup refresh | `update` |
| Install reusable skills | `install` (interactive; optional `--scope`/`--agents` overrides) |
| Lint, links, quality, or all diagnostics | `--lint`, `--link-check`, `--quality-check`, `--doctor` |
| Search and bounded retrieval | `--query`, `--wiki-impact`, `--wiki-neighborhood` |
| Router, inbox, glossary, or stale-page work | `--refresh-index`, `--capture-inbox`, `--glossary-init`, `--prune-check` |
| Local session handoff | `--handoff-save`, `--handoff-show`, `--handoff-status`, `--handoff-clear`, `--handoff-promote-inbox` |

`install` prompts for the scope and agent surfaces when run in a TTY. `update` prompts for scope in a TTY, then prompts for targets (`skill` and project `agents`) only for project scope; user scope immediately updates installed user skills, and update never writes the project wiki. Use explicit `--scope`, `--targets`, and optional `--agents` for non-interactive automation. Use `init` for missing wiki setup and explicit wiki maintenance options such as `--refresh-index` for wiki changes. Use `--no-git-config` when hook files are wanted without changing `git core.hooksPath`.

## Quality standard

Prefer a small number of clearly owned, answerable pages over a large document collection. A useful wiki gives each important fact one current home, makes rationale and evidence discoverable, exposes unresolved items honestly, and keeps startup routing compact.

Run the smallest checks that prove the change, normally `--lint` and `--link-check`; use `--doctor` for routing or quality changes. When skill guidance changes, verify every installed skill copy has the same contract.

For PRD visuals, check that every referenced HTML file exists, has a text-accessible summary, uses stable local links, and still matches the linked requirements, decisions, and source evidence.

Session handoff files are generated local reference data, not durable planning truth. Promote selected facts through the inbox and taxonomy before treating them as project knowledge.

## Issue reporting

If this skill reveals a bug, regression, confusing generated behavior, or mismatch between this contract and the runner, run `--issue-draft --issue-title "..."` before reporting. Create an external issue with `--issue-create` only after explicit user approval.
