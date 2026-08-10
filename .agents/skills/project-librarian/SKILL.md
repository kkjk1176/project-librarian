---
name: project-librarian
description: Bootstrap, update, migrate, validate, search, and code-canonicalize a service- and PRD-centered project planning wiki.
metadata:
  short-description: Service/PRD planning wiki
---

# Project Librarian

Use this skill to operate a compact, durable planning wiki in the current project. Resolve and run the local Project Librarian runner yourself; ask users for outcomes, not lifecycle flags, unless they explicitly request shell commands.

## Service/PRD v2 contract

The durable route is <code>service → PRD/initiative → document area → focused artifact</code>.

    wiki/
      00-index/                 service map and PRD registry
      01-governance/            source-of-truth and writing rules
      10-services/<service>/    service truth and PRD hubs
      20-shared/                cross-service contracts and glossary
      30-portfolio/             cross-PRD sequencing and roadmap
      90-archive/               retired material
      inbox/  indexes/  meta/  migration/

- Fresh <code>init</code> creates only common v2 hubs; it never invents a service or PRD.
- <code>update</code> preserves existing lifecycle-root material and adds or refreshes v2 operating hubs.
- New product, decision, evidence, and planning writes use only <code>10-services/</code>, <code>20-shared/</code>, or <code>30-portfolio/</code>.
- Put PRD discovery through release artifacts under the registered PRD hub; use <code>09-decisions/</code>, <code>10-sources/</code>, and <code>11-plans/</code> for rationale, evidence, and detailed execution.
- The former <code>canonical/</code>, <code>roadmaps/</code>, <code>plans/</code>, <code>decisions/</code>, and <code>sources/</code> roots are read-compatible legacy material only. Never create or write new content there.
- Keep wiki operations, taxonomy, and migration contracts in <code>wiki/meta/</code>; keep unreviewed material in <code>wiki/inbox/</code>.

Every v2 document carries <code>status</code>, <code>updated</code>, <code>scope</code>, <code>type</code>, <code>owner</code>, <code>read_budget</code>, <code>decision_ref</code>, and <code>review_trigger</code>; service and PRD artifacts additionally declare their service and, when applicable, stable PRD ID.

## Supported work

- Bootstrap, update, install, or synchronize the wiki, agent instructions, hooks, and reusable skill copies.
- Validate setup; diagnose links, duplicate routes, orphan pages, topology, migration state, and quality signals.
- Search wiki content, refresh its router, capture inbox candidates, initialize the shared glossary, and review migration coverage.
- Save, inspect, promote, inject, or clear generated local session handoff state under <code>.project-wiki/session/</code>.
- Build, inspect, query, and use the optional SQLite code-evidence index for large-repository structure questions.
- Turn broad maintenance requests into an evidence-backed backlog and then execute safe, scoped work.
- Draft an issue body when the runner and this contract diverge.

## Runner and lifecycle workflow

1. Resolve a local runner from the project root. Prefer <code>node dist/init-project-wiki.js</code> in this source repository, then <code>.agents/skills/project-librarian/dist/init-project-wiki.js</code>, then the project-scoped Codex, Claude, Cursor, or Gemini copy. Use a pinned registry package only when no local runner exists and registry execution is acceptable.
2. Read <code>wiki/startup.md</code>, <code>wiki/index.md</code>, then <code>wiki/00-index/</code>; follow the owning service, PRD hub, shared area, portfolio route, or compatibility page only as needed.
3. Classify planning material using <code>wiki/meta/document-taxonomy.md</code>: owner first, then service, PRD, document area, lifecycle state, and current/future/decision/evidence role.
4. Update the narrowest v2 artifact and the relevant hub or registry. Do not use a hub as a catch-all document.
5. Preserve legacy meaning during migration. Mark conflicting legacy operating material superseded or route it through compatibility/archive; do not delete it merely to change structure.

Map requests to the local runner:

| Request | Command |
| --- | --- |
| Fresh setup | <code>init</code> |
| Existing setup refresh | <code>update</code> |
| Install or synchronize reusable skills | <code>install --scope user\|project --agents codex\|claude\|cursor\|gemini\|all</code> |
| Preserve and restructure legacy docs | <code>--migrate</code> |
| Lint, links, quality, or all diagnostics | <code>--lint</code>, <code>--link-check</code>, <code>--quality-check</code>, <code>--doctor</code> |
| Search and bounded retrieval | <code>--query</code>, <code>--wiki-impact</code>, <code>--wiki-neighborhood</code> |
| Router, inbox, glossary, or stale-page work | <code>--refresh-index</code>, <code>--capture-inbox</code>, <code>--glossary-init</code>, <code>--prune-check</code> |
| Migration review | <code>--review-migration</code>, <code>--migration-doctor</code> |
| Local session handoff | <code>--handoff-save</code>, <code>--handoff-show</code>, <code>--handoff-status</code>, <code>--handoff-clear</code>, <code>--handoff-promote-inbox</code>, <code>--handoff-injection-enable</code>, <code>--handoff-injection-disable</code>, <code>--handoff-injection-status</code> |

<code>install-skill</code> remains a compatibility alias. A project update refreshes already managed or present agent surfaces only; it does not create unrelated agent directories. Use explicit <code>--agents</code> to add a surface. Use <code>--no-git-config</code> when hook files are wanted without changing <code>git core.hooksPath</code>.

## Broad improvement work

For “improve this project”, maintenance automation, or efficiency requests without a concrete command:

1. Inspect the relevant wiki, code, tests, CI, release gates, dependency posture, and maintenance bottlenecks.
2. For structural or large-repository questions, use code evidence; for small, simple lookups, read the narrow scope directly.
3. Produce a ranked backlog with evidence, confidence, risk, and verification.
4. Store PRD-specific work in that PRD’s <code>11-plans/</code>; store cross-PRD work in <code>30-portfolio/</code>.
5. When asked to proceed, implement safe high-priority items in a branch, synchronize generated outputs, and run targeted tests plus the smallest broad gate that proves the result.

## Code evidence

Use <code>--code-index</code> (or <code>--code-evidence-index</code>) for repeated or large-scope analysis. Scope it with <code>--code-scope</code>; inspect freshness with <code>--code-status</code>; then use <code>--code-files</code>, <code>--code-report</code>, <code>--code-impact</code>, <code>--code-context-pack</code>, <code>--code-search-symbol</code>, or conservative read-only <code>--code-query</code>.

The cache lives at <code>.project-wiki/code-evidence.sqlite</code>, is regenerable evidence rather than wiki truth, and must not be copied into <code>wiki/</code>. Treat stale output as a rebuild pointer, not current structural evidence. Use <code>--code-index-health</code> before a schema change, <code>--code-index-migrate</code> only with explicit replacement approval, <code>--incremental</code> only with a compatible cache, and <code>--code-parser tree-sitter</code> only when its optional parser packages are installed. Keep code scopes within the project root and preserve the runner’s sensitive-file exclusions.

## Handoff and migration boundaries

Session handoff files are generated local reference data, not durable planning truth. Do not promote them directly into current-truth, plan, or decision artifacts; classify stable facts through the inbox/taxonomy workflow first.

Migration is review-first. Account for each legacy unit as adopted, merged, superseded, rejected, resolved, or <code>needs-human-review</code>. New migration targets must be registered v2 service/PRD, shared, portfolio, or meta routes; never use a lifecycle root or archive as active truth.

## Verification and failure handling

Run the smallest checks that prove the scoped change: normally <code>--lint</code> and <code>--link-check</code>; use <code>--doctor</code>, migration diagnostics, hook JSON parsing, or focused code tests when the change touches those surfaces. When skills or public guidance change, verify every installed skill copy has the same contract.

If the runner fails, report the original error and fix its cause when authorized. Do not manually recreate generated bootstrap or migration output, downgrade a failure, or add fallback behavior that silently assumes the failure away.

## Issue reporting

If this skill reveals a bug, regression, confusing generated behavior, unintended side effect, or mismatch between this contract and the runner, run <code>--issue-draft --issue-title "…"</code> before reporting. The draft is read-only and is required even when a local fix is made. Create an external issue with <code>--issue-create</code> only after explicit user approval and only when the repository, GitHub CLI, authentication, and network checks succeed; otherwise report the real error.
