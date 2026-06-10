---
status: active
updated: 2026-06-10
scope: wiki-router
read_budget: short
decision_ref: wiki/meta/wiki-ops-v1-decisions.md
review_trigger: wiki page added, moved, removed, or routing changes
---

# Wiki Index

## Use

Router only. Read detailed files only when relevant.

## Language Policy

- Generated operating docs are English by default.
- Project canonical language follows user/project context.

## Boundary Rule

- `wiki/canonical/` and `wiki/decisions/` are project-planning only.
- Wiki operating rules/decisions live in `wiki/meta/`.
- LLM workflow instructions belong in AGENTS/hooks/skills, not canonical/decisions.

## Startup

- [[startup]]: session start, compact project state, route hints. Budget: short.

## Canonical

- [[canonical/project-brief]]: product direction, audience, scope, scenarios. Budget: medium.
- [[canonical/open-questions]]: unresolved questions. Budget: short.
- [[canonical/assumptions]]: assumptions. Budget: short.
- [[canonical/risks]]: risks and revisit triggers. Budget: short.
- [[canonical/distribution-and-verification]]: distribution/verification overview. Budget: medium.
- [[canonical/package-release-contract]]: package metadata, runtime, npm versioning, release gates. Budget: medium.
- [[canonical/verification-and-skill-installation]]: build/test, smoke coverage, skill install. Budget: medium.
- [[canonical/cli-behavior]]: CLI overview, bootstrap, mode-family routing, boundaries. Budget: medium.
- [[canonical/cli-lifecycle-modes]]: diagnostics, query, refresh-index, inbox, prune, glossary, skill install. Budget: medium.
- [[canonical/cli-issue-reporting]]: issue-draft, issue-create, approval/GitHub CLI contract. Budget: medium.
- [[canonical/cli-hooks-and-migration]]: Codex/Claude/Cursor/Gemini hooks, Cursor/Gemini instruction files, git hooks, migration, copy-risk checks. Budget: medium.
- [[canonical/cli-code-evidence-modes]]: code evidence CLI flags, report sections, impact mode. Budget: medium.
- [[canonical/code-evidence-index]]: code evidence overview, storage, discovery, schema, claim boundary. Budget: medium.
- [[canonical/code-evidence-extraction]]: parser backends, languages, extraction, workspace/CODEOWNERS adapters. Budget: medium.
- [[canonical/code-evidence-query-and-updates]]: SQL safety, staleness, impact, incremental updates. Budget: medium.
- [[canonical/code-evidence-reports]]: architecture, ownership, workspace graph, route/dependency/config reports. Budget: medium.
- [[canonical/benchmark-and-release-evidence]]: benchmark metrics, release claims, baselines. Budget: on-demand.

## Project Decisions

- [[decisions/recent]]: recent important project decisions. Budget: short.
- [[decisions/log]]: timestamped lightweight decisions. Budget: on-demand.
- [[decisions/README]]: decision directory overview. Budget: short.
- [[decisions/npm-release-policy]]: npm publication, versioning, release gates. Budget: medium.
- [[decisions/large-project-roadmap-and-metrics]]: large-project roadmap, benchmark methodology. Budget: medium.
- [[decisions/decision-pack-template]]: Decision Pack format. Budget: short.
- [[decisions/full-adr-template]]: Full ADR format. Budget: short.

## Wiki Meta

- [[meta/operating-model]]: wiki operation, hooks, maintenance. Budget: medium.
- [[meta/decision-policy]]: decision levels and ADR criteria. Budget: medium.
- [[meta/wiki-ops-v1-decisions]]: wiki operating decisions. Budget: medium.
- [[meta/code-map]]: code map and evidence routes. Budget: medium.

## Sources And Inbox

- [[sources/karpathy-llm-wiki]]: source pattern and LLM Wiki rationale. Budget: short.
- [[inbox/project-candidates]]: captured project candidates not yet adopted. Budget: on-demand.

<!-- PROJECT-WIKI-AUTO-INDEX:START -->
## Auto-Discovered Pages

Managed by `--refresh-index`. Move useful rows above when they become normal routes.

| Document | Scope | Status | Token Budget |
| --- | --- | --- | --- |
| none | - | - | - |
<!-- PROJECT-WIKI-AUTO-INDEX:END -->
