import type { WikiBudget, WikiStatus } from "./types";
import { today } from "./workspace";

export const wikiTrustContract = "Wiki decision documents are authoritative for project decisions; revisit them only when directly conflicting repository evidence appears or the recorded review trigger fires.";

// B1 fallback: label for the auto-synced startup TL;DR sub-block embedded in the
// managed AGENTS.md marker section. Non-interactive `codex exec` does not run
// SessionStart hooks (measured 2026-06-10), so AGENTS.md is the only startup
// context carrier there; the sync stays TL;DR-only per token discipline.
export const startupTldrSyncLabel = "Startup TL;DR (auto-synced for non-interactive sessions; source: wiki/startup.md)";

// Hard cap on the extracted TL;DR text embedded in AGENTS.md. The startup hook
// budget is 3500 chars for the full wiki/startup.md; the TL;DR sub-section must
// stay well under that so the managed block remains token-efficient. 2000 chars is
// a documented hard bound: it leaves headroom for frontmatter, other sections, and
// the AGENTS.md surrounding content. Per the no-fallback rule, we NEVER truncate —
// if the extracted bullets exceed this limit the sync fails loudly so the author
// knows to trim the TL;DR.
export const STARTUP_TLDR_MAX_CHARS = 2000;

// Extract the `## TL;DR` bullet list from a startup.md body (TL;DR section ONLY —
// never Recent Decisions or Project State). Returns the `- ` bullet lines between
// the `## TL;DR` heading and the next `## ` heading. Throws loudly when the
// startup body has no `## TL;DR` section, that section has no bullets, or the
// extracted text exceeds STARTUP_TLDR_MAX_CHARS (no fallback, no silent truncation).
export function extractStartupTldr(startupMarkdown: string): string {
  const match = startupMarkdown.match(/^##\s+TL;DR[^\n]*\n([\s\S]*?)(?=\n##\s|(?![\s\S]))/m);
  if (!match) {
    throw new Error("cannot sync startup TL;DR into AGENTS.md: wiki/startup.md has no \"## TL;DR\" section");
  }
  const bullets = (match[1] ?? "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => /^\s*-\s+\S/.test(line));
  if (bullets.length === 0) {
    throw new Error("cannot sync startup TL;DR into AGENTS.md: the wiki/startup.md \"## TL;DR\" section has no bullet items");
  }
  const result = bullets.join("\n");
  if (result.length > STARTUP_TLDR_MAX_CHARS) {
    throw new Error(
      `cannot sync startup TL;DR into AGENTS.md: extracted TL;DR is ${result.length} chars, which exceeds the ${STARTUP_TLDR_MAX_CHARS}-char limit; trim the ## TL;DR section in wiki/startup.md`,
    );
  }
  return result;
}

// Build the managed AGENTS.md marker section. The startup TL;DR is synced in as a
// clearly labeled sub-block (B1 fallback) so non-interactive Codex sessions, which
// never run the SessionStart hook, still receive compact startup context; the
// trust contract sentence (B4) is appended to the during-conversation rules. Only
// this marker block changes; user content outside the markers is untouched, and
// because the section is built deterministically from the current startup TL;DR a
// re-run with unchanged startup yields the same section ("exists" via
// upsertMarkedSection).
export function agentsSection(startupTldr: string): string {
  return `<!-- PROJECT-WIKI-FIRST:START -->
## Wiki-First Planning

This project uses \`./wiki\` as the durable project-planning source of truth.

At the start of every session:

1. Review \`wiki/startup.md\` for compact current context.
2. Review \`wiki/index.md\` as the router for which files to read next.
3. Follow \`wiki/00-index/\` into the owning service, PRD hub, shared area, portfolio route, or compatibility page; read detailed pages on demand only when the current question needs them.

### ${startupTldrSyncLabel}

${startupTldr}

During conversation:

- Update \`./wiki\` in the same turn when project planning content is added, changed, or removed.
- Classify new project-planning content with \`wiki/meta/document-taxonomy.md\` before writing or consolidating it.
- Do not store non-project LLM memory, assistant preferences, collaboration reminders, or workflow instructions in service, PRD, shared, or decision docs.
- Follow \`wiki/AGENTS.md\` for detailed rules when editing files under \`wiki/\`.
- Treat broad maintenance/improvement automation requests that do not name a concrete command (for example "improve this project", "start improvement automation", or "개선 자동화 시작해") as analyze-first project work, not as a plain bootstrap/update. Inspect repo, wiki, CI, test, release, dependency, and code-structure evidence; produce a ranked backlog with evidence and verification paths; persist PRD-specific plans in the PRD's \`11-plans/\` area and cross-PRD plans in \`wiki/30-portfolio/\`; then execute safe high-priority items with tests.
- Do not execute worktree-controlled commit hooks for wiki trailers; add trailers explicitly when needed.
- ${wikiTrustContract}
<!-- PROJECT-WIKI-FIRST:END -->`;
}

export const claudeSection = `<!-- PROJECT-WIKI-CLAUDE:START -->
# Claude Code Project Instructions

@AGENTS.md

## Claude Code Notes

Claude Code reads \`CLAUDE.md\`, not \`AGENTS.md\`, so this file imports \`AGENTS.md\` to share the same wiki-first planning contract with Codex and other agents. Bootstrap also installs a Claude Code \`SessionStart\` hook in \`.claude/settings.json\` for compact wiki startup context.

At session start, follow the imported instructions: review \`wiki/startup.md\` and \`wiki/index.md\` first, then route through the owning service or PRD hub on demand.
<!-- PROJECT-WIKI-CLAUDE:END -->`;

export const geminiSection = `<!-- PROJECT-WIKI-GEMINI:START -->
# Gemini CLI Project Instructions

@AGENTS.md

## Gemini CLI Notes

Gemini CLI reads \`GEMINI.md\` by default, so this file imports \`AGENTS.md\` to share the same wiki-first planning contract with Codex, Claude Code, Cursor, and other agents.

At session start, follow the imported instructions: review \`wiki/startup.md\` and \`wiki/index.md\` first, then route through the owning service or PRD hub on demand.
<!-- PROJECT-WIKI-GEMINI:END -->`;

export const cursorRule = `---
alwaysApply: true
---

# Project Librarian Wiki-First Planning

Use the repository root \`AGENTS.md\` as the project-wide instruction source.

@AGENTS.md
`;

export const wikiAgentsSection = `<!-- PROJECT-WIKI-INTERNAL:START -->
## Wiki Internal Rules

This file applies to \`./wiki\` and its children. Root \`AGENTS.md\` owns the project-wide wiki-first contract. Root \`CLAUDE.md\` and \`GEMINI.md\` import \`AGENTS.md\` for agent compatibility. This file owns detailed wiki editing rules.

Language policy:

- Wiki operating documents generated by this bootstrap are English by default.
- Project canonical content does not have a fixed default language. The LLM should choose the language that best matches the user's language, project context, and surrounding materials, then keep that choice consistent.
- If the user explicitly asks for a language, that instruction wins.

Reading rules:

- Treat \`startup.md\` as compact session context and \`index.md\` as the router.
- Follow the primary \`00-index/ -> 10-services/ -> PRD hub -> document area\` route first.
- Read detailed service, PRD, shared, portfolio, and legacy compatibility pages on demand only when the current question needs them.
- Prefer each file's TL;DR and metadata before reading the full body.

Storage boundaries:

- \`00-index/\` contains the service map, PRD registry, and navigation hubs.
- \`01-governance/\` contains documentation governance and source-of-truth rules.
- \`10-services/<service>/\` contains service truth, operations, metrics, and \`prds/<PRD-ID-slug>/\` initiative documentation.
- A PRD uses \`01-discovery/\` through \`08-roadmap/\`, then \`09-decisions/\`, \`10-sources/\`, and \`11-plans/\` as needed.
- \`20-shared/\` contains contracts and terminology shared by multiple services or PRDs.
- \`30-portfolio/\` contains cross-PRD roadmap and sequencing work.
- \`90-archive/\` contains retired material that must remain recoverable.
- Existing \`canonical/\`, \`roadmaps/\`, \`plans/\`, \`decisions/\`, and \`sources/\` directories are read-only compatibility roots; do not route new writes there.
- \`meta/\` contains wiki operating rules, decision policy, bootstrap, lint, and hook decisions.
- \`inbox/\` contains candidates, not current truth.
- Do not store non-project LLM memory, assistant preferences, collaboration reminders, or workflow instructions in project truth or decision docs; use root \`AGENTS.md\`, compatibility instruction files, hooks, rules, or skills instead.

Classification rules:

- Before adding or consolidating project content, classify it with \`meta/document-taxonomy.md\`.
- Identify the owning service and stable PRD ID before selecting the document area.
- Write current agreement to the narrowest durable service, PRD, or shared document; do not append unrelated material to a PRD hub.
- Put PRD-specific future work in its \`11-plans/\` area and cross-PRD work in \`30-portfolio/\`.
- Put decisions and evidence beside the PRD in \`09-decisions/\` and \`10-sources/\`.
- When work completes, update current service/PRD truth first and preserve rationale/evidence before retiring the plan.
- If one input crosses several lifecycle areas, split it into separate canonical updates and link the related pages.
- If the input explains why a direction changed, update the relevant decision log or Decision Pack in addition to canonical truth.
- If an external artifact is the better source of truth (for example Figma, OpenAPI, ERD, issue tracker, or code), keep a concise canonical summary and link the external source as the authoritative location.

Update rules:

- Every wiki knowledge markdown file should include compact metadata with \`status\`, \`updated\`, \`scope\`, \`type\`, \`read_budget\`, \`decision_ref\`, \`review_trigger\`, and \`owner\`. Service and PRD pages also require matching \`service\` and, for PRDs, \`prd_id\`. This \`wiki/AGENTS.md\` instruction file is excluded.
- Put a compact TL;DR near the top of service, PRD, shared, decision, meta, source, and inbox pages.
- Update \`startup.md\` when session-start summary, recent important decisions, open questions, routing hints, or project-language choice changes.
- Update \`index.md\` when adding, moving, removing, or materially changing wiki pages.
- Keep decision records in the owning PRD's \`09-decisions/\` area; use Decision Packs or ADRs according to impact.
- Initialize \`20-shared/glossary.md\` when terminology becomes useful.

Commit rules:

- Follow the repository's commit-message policy when one exists.
- Do not execute worktree-controlled commit hooks for wiki trailers; add trailers explicitly when needed.
- If bootstrap was run with \`--no-git-config\`, hook files are installed but \`core.hooksPath\` is not changed.
- Hand-write wiki trailers when project policy requires them; keep them accurate and evidence-backed.
<!-- PROJECT-WIKI-INTERNAL:END -->`;

export interface WikiMetadataOptions {
  owner?: string;
  prdId?: string;
  service?: string;
  type?: string;
}

export const metadata = (scope: string, budget: WikiBudget, decisionRef: string, trigger: string, status: WikiStatus = "active", options: WikiMetadataOptions = {}): string => `---
status: ${status}
updated: ${today}
scope: ${scope}
type: ${options.type ?? scope}
read_budget: ${budget}
decision_ref: ${decisionRef}
review_trigger: ${trigger}
owner: ${options.owner ?? "unassigned"}${options.service ? `\nservice: ${options.service}` : ""}${options.prdId ? `\nprd_id: ${options.prdId}` : ""}
---
`;

export const startup = `${metadata("startup-router", "short", "wiki/meta/wiki-ops-v2-decisions.md", "session-start summary, service/PRD routing, language policy, or open project state changes", "active", { type: "router" })}
# Startup Context

## TL;DR

- This project is in an initial planning state until services and PRDs are registered.
- Project truth lives under \`wiki/10-services/\` and \`wiki/20-shared/\`; cross-PRD future work lives in \`wiki/30-portfolio/\`.
- Start at \`wiki/00-index/\`, then follow service -> PRD/initiative -> document area.
- Wiki operating rules and wiki operating decisions live in \`wiki/meta/\`.
- At session start, read only this file and \`wiki/index.md\` first; use the index as a route table, open matching detail files directly, and avoid broad repo/wiki search unless no route matches.
- Existing lifecycle roots, when present, are read-only compatibility pages.
- Update the wiki in the same turn when project-planning content changes.
- Classify new project-planning content with \`wiki/meta/document-taxonomy.md\` before writing or consolidating it.

## Read On Demand

- [[index]]: document router.
- [[00-index/README]]: service and PRD navigation entry point.
- [[00-index/service-map]]: registered service boundaries.
- [[00-index/prd-registry]]: registered PRDs and initiative hubs.
- [[meta/document-taxonomy]]: read only when classifying or reorganizing project wiki content.

## Project State

- Registered services: none yet.
- Registered PRDs: none yet.
- Shared contracts: none yet.
- Portfolio work: none yet.
- Project content language: to be selected from user/project context.

## Recent Project Decisions

- None yet.

## Wiki Operating Pointers

- Decision recording follows [[01-governance/README]] and [[meta/decision-policy]].
- Wiki operation follows [[meta/operating-model]].
- Wiki operating decisions are recorded only in [[meta/wiki-ops-v2-decisions]], not in product decision areas.

## Token Discipline

- Codex, Claude Code, Cursor, and Gemini CLI session-start hooks inject only this file and \`wiki/index.md\`.
- Detailed files are selected by \`wiki/index.md\`; use broad wiki search only when no route matches or evidence conflicts.
- Long decision history is not injected wholesale; read only relevant Decision Packs or ADRs.
`;

export const index = `${metadata("wiki-router", "short", "wiki/meta/wiki-ops-v2-decisions.md", "service, PRD, document area, or routing link changes", "active", { type: "router" })}
# Wiki Index

## Use

Use \`service -> PRD/initiative -> document area -> focused artifact\`. This is a route table, not a page inventory.

## Primary Routes

- [[00-index/README]] - navigation entry point.
- [[00-index/service-map]] - service registry.
- [[00-index/prd-registry]] - PRD registry.
- [[01-governance/README]] - source-of-truth and writing rules.
- [[10-services/README]] - service hubs.
- [[20-shared/README]] - cross-service contracts and terminology.
- [[30-portfolio/README]] - cross-PRD roadmap and sequencing.
- [[90-archive/README]] - retired material.

## Language Policy

- Generated operating pages are English by default.
- Product content follows the user, project, and surrounding source material unless the user requests another language.

## Storage Contract

- Service-wide truth: \`wiki/10-services/<service>/\`.
- PRD truth and lifecycle artifacts: \`wiki/10-services/<service>/prds/<PRD-ID-slug>/\`.
- Shared truth: \`wiki/20-shared/\`.
- Cross-PRD future work: \`wiki/30-portfolio/\`.
- Existing \`canonical/\`, \`roadmaps/\`, \`plans/\`, \`decisions/\`, and \`sources/\` roots are read-only compatibility pages when present.

## Startup

- [[startup]]
  - Read: every session start or compact project state lookup.
  - Update: startup summary, recent decisions, open questions, routes, language policy.
  - Token budget: short.

## Wiki Meta

- [[meta/operating-model]]
  - Read: wiki operation, hooks, bootstrap, maintenance, language policy.
  - Update: wiki operation or startup behavior changes.
  - Token budget: medium.
- [[meta/document-taxonomy]]
  - Read: classifying, writing, consolidating, splitting, or reorganizing project wiki content.
  - Update: wiki information architecture or service-documentation categories change.
  - Token budget: medium.
- [[meta/decision-policy]]
  - Read: decision level, ADR need, canonical/decision split.
  - Update: decision classification or ADR criteria changes.
  - Token budget: medium.
- [[meta/wiki-ops-v2-decisions]]
  - Read: wiki operating decisions, rejected alternatives, rationale.
  - Update when: wiki operating decisions change.
  - Token budget: medium.
`;

export const glossary = `${metadata("shared-glossary", "medium", "wiki/meta/wiki-ops-v2-decisions.md", "shared terms, roles, states, permissions, events, entities, API names, DB names, or UI labels change", "active", { type: "shared" })}
# Glossary

## TL;DR

- This file is the naming contract for project/product terminology.
- Do not store wiki operating terms, LLM collaboration instructions, or general working memory here.
- Prefer shared terms from this file for API, database, UI, and policy wording.
- Use the project language chosen in [[startup]] unless the user says otherwise.

## Terms

| Term | Definition | Avoid | Related Service/PRD Doc | Status |
| --- | --- | --- | --- | --- |
|  |  |  |  | proposed |
`;

export const glossaryIndexBlock = `<!-- PROJECT-WIKI-GLOSSARY:START -->
## Glossary

- [[20-shared/glossary]]
  - Read: terms, roles, states, permissions, events, API/DB/UI names, naming conflicts.
  - Update: core term is added, renamed, or deprecated.
  - Token budget: medium.
<!-- PROJECT-WIKI-GLOSSARY:END -->`;

export const inboxIndexBlock = `<!-- PROJECT-WIKI-INBOX:START -->
## Inbox

- [[inbox/project-candidates]]
  - Read: captured project candidates not yet adopted, classified by service, PRD, and type when known.
  - Update: \`--capture-inbox\` adds a candidate or its ownership/status changes.
  - Token budget: on-demand.
<!-- PROJECT-WIKI-INBOX:END -->`;

export const wikiOperatingModelV2 = `${metadata("wiki-meta", "medium", "wiki/meta/wiki-ops-v2-decisions.md", "service/PRD structure, hooks, bootstrap, language, or reading policy changes", "active", { type: "wiki-meta" })}
# Wiki Operating Model

## TL;DR

- The writable knowledge model is service -> PRD/initiative -> document area.
- Current truth belongs under \`10-services/\` or \`20-shared/\`; cross-PRD future work belongs under \`30-portfolio/\`.
- Existing lifecycle roots are read-only compatibility inputs and are never created by fresh bootstrap.
- Startup hooks inject only \`startup.md\` and \`index.md\`.

## Routing

1. Register the service in [[00-index/service-map]].
2. Register each stable PRD ID in [[00-index/prd-registry]].
3. Route service-wide truth through \`10-services/<service>/\`.
4. Route initiative artifacts through \`10-services/<service>/prds/<PRD-ID-slug>/\`.
5. Use \`20-shared/\` only when more than one service or PRD owns the contract.
6. Use \`30-portfolio/\` for sequencing across PRDs.

## PRD Areas

| Area | Purpose |
| --- | --- |
| \`01-discovery/\` | problem, users, evidence, opportunity |
| \`02-requirements/\` | accepted requirements and policy |
| \`03-design/\` | UX, architecture, data, and API design |
| \`04-delivery/\` | implementation and rollout state |
| \`05-validation/\` | QA, acceptance, and evidence |
| \`06-operations/\` | runbooks and production operation |
| \`07-metrics/\` | KPI definitions and observed signals |
| \`08-roadmap/\` | PRD-local future direction |
| \`09-decisions/\` | rationale and ADRs |
| \`10-sources/\` | external and measured evidence |
| \`11-plans/\` | detailed execution plans |

## Metadata

Knowledge pages use \`status\`, \`updated\`, \`scope\`, \`type\`, \`read_budget\`, \`decision_ref\`, \`review_trigger\`, and \`owner\`. Service pages require matching \`service\`; PRD pages also require matching \`prd_id\`.

## Compatibility

Queries, links, impact, and neighborhood continue to read existing \`canonical/\`, \`roadmaps/\`, \`plans/\`, \`decisions/\`, and \`sources/\` pages. New writes use only the v2 writable roots.
`;

export const decisionPolicyV2 = `${metadata("wiki-meta", "medium", "wiki/meta/wiki-ops-v2-decisions.md", "decision levels, ownership, or ADR criteria change", "active", { type: "wiki-meta" })}
# Decision Policy

## TL;DR

- Put a decision beside its owning PRD in \`09-decisions/\`.
- Put service-wide or cross-service governance decisions in the narrowest owning service or shared area.
- Use a short decision record for reversible choices, a Decision Pack for related choices, and a full ADR for high-cost or likely-to-be-challenged changes.
- \`decision_ref\` points from current truth to its rationale.

## Levels

1. Current-truth-only edit: no durable rationale is needed.
2. Decision note: timing or a rejected alternative matters.
3. Decision Pack: several choices share one topic and revisit trigger.
4. Full ADR: product direction, architecture, public API, data model, security, permissions, compliance, or adoption cost is material.
`;

export const documentTaxonomyV2 = `${metadata("wiki-meta", "medium", "wiki/meta/wiki-ops-v2-decisions.md", "service/PRD information architecture or classification rules change", "active", { type: "wiki-meta" })}
# Document Taxonomy

## TL;DR

- Identify service, PRD ID, document area, lifecycle state, and owner before writing.
- Use service scope only for truth shared by all of that service's PRDs.
- Use \`20-shared/\` only for contracts genuinely shared across services or PRDs.
- Legacy lifecycle roots are compatibility inputs, not valid targets for new content.

## Classification Order

1. Which service owns the content?
2. Is there a stable PRD/initiative ID?
3. Which PRD area from \`01-discovery\` through \`11-plans\` owns it?
4. Is it current truth, future work, rationale, evidence, or an unresolved candidate?
5. Who owns review and what event triggers an update?

Unknown ownership stays in \`inbox/\` with \`owner: unassigned\`; it does not become current truth automatically.
`;

export const v2StarterFiles = {
  "wiki/README.md": `${metadata("wiki-entry", "short", "wiki/meta/wiki-ops-v2-decisions.md", "top-level wiki structure changes", "active", { type: "wiki-entry" })}
# Project Wiki

Start with [[startup]], [[index]], or [[00-index/README]]. Durable product knowledge is organized by owning service and PRD.
`,
  "wiki/00-index/README.md": `${metadata("wiki-index", "short", "wiki/meta/wiki-ops-v2-decisions.md", "service or PRD routing changes", "active", { type: "router" })}
# Navigation

## TL;DR

- Start with the service map, then choose a registered PRD hub.
- Use shared or portfolio routes only when ownership crosses PRDs.

- [[00-index/service-map]]
- [[00-index/prd-registry]]
- [[10-services/README]]
- [[20-shared/README]]
- [[30-portfolio/README]]
`,
  "wiki/00-index/service-map.md": `${metadata("service-registry", "short", "wiki/meta/wiki-ops-v2-decisions.md", "a service is added, renamed, retired, or changes ownership", "active", { type: "router" })}
# Service Map

## TL;DR

- No services are registered yet.
- Add a stable lowercase service slug and link its hub before creating PRDs.

| Service | Owner | Hub | Status |
| --- | --- | --- | --- |
| none | - | - | - |
`,
  "wiki/00-index/prd-registry.md": `${metadata("prd-registry", "short", "wiki/meta/wiki-ops-v2-decisions.md", "a PRD is added, renamed, retired, or changes ownership/status", "active", { type: "router" })}
# PRD Registry

## TL;DR

- No PRDs are registered yet.
- PRD IDs are stable; rename only the slug portion of \`PRD-NNN-slug\`.

| PRD ID | Service | Owner | Hub | Status |
| --- | --- | --- | --- | --- |
| none | - | - | - | - |
`,
  "wiki/01-governance/README.md": `${metadata("documentation-governance", "medium", "wiki/meta/wiki-ops-v2-decisions.md", "source-of-truth, ownership, metadata, or review rules change", "active", { type: "governance" })}
# Documentation Governance

## TL;DR

- Register service and PRD ownership before creating durable product pages.
- Current truth lives in service, PRD, or shared areas; plans, decisions, and sources remain beside their owner.
- Existing lifecycle roots are read-only compatibility pages.

See [[meta/operating-model]], [[meta/document-taxonomy]], and [[meta/decision-policy]].
`,
  "wiki/10-services/README.md": `${metadata("service-registry", "short", "wiki/meta/wiki-ops-v2-decisions.md", "service hubs are added, moved, or retired", "active", { type: "service-registry" })}
# Services

## TL;DR

- No service hubs exist yet.
- Create \`10-services/<service>/README.md\` and \`service-overview.md\` only after registration.
`,
  "wiki/20-shared/README.md": `${metadata("shared-index", "short", "wiki/meta/wiki-ops-v2-decisions.md", "shared contracts or terminology change", "active", { type: "shared" })}
# Shared

## TL;DR

- Keep only contracts or terminology owned by more than one service or PRD here.
- Prefer the narrowest service or PRD owner when sharing is not real.
`,
  "wiki/30-portfolio/README.md": `${metadata("portfolio", "medium", "wiki/meta/wiki-ops-v2-decisions.md", "cross-PRD priorities, sequencing, or dependencies change", "active", { type: "portfolio" })}
# Portfolio

## TL;DR

- No cross-PRD roadmap items are registered yet.
- PRD-local plans belong in the owning PRD's \`11-plans/\` area.
`,
  "wiki/90-archive/README.md": `${metadata("archive", "on-demand", "wiki/meta/wiki-ops-v2-decisions.md", "retention rules or archived routes change", "active", { type: "archive" })}
# Archive

## TL;DR

- Retired material remains recoverable here but is never active truth.
- Record the replacement route and retirement reason when archiving a page.
`,
  "wiki/meta/document-taxonomy.md": documentTaxonomyV2,
  "wiki/meta/wiki-ops-v2-decisions.md": `${metadata("wiki-meta-decisions", "medium", "self", "service/PRD wiki operating decisions change", "active", { type: "wiki-meta" })}
# Wiki Operations v2 Decisions

## TL;DR

- The accepted write model is service -> PRD/initiative -> document area.
- Lifecycle roots remain read-compatible but are not created or accepted as new targets.
- Fresh bootstrap creates neutral hubs and does not invent a service or PRD.

Status: accepted

| Date | Decision | Rationale | Revisit Trigger |
| --- | --- | --- | --- |
| ${today} | Organize durable knowledge by service and stable PRD ID. | Ownership and retrieval remain local as PRD count grows. | Teams cannot assign stable service or PRD ownership. |
| ${today} | Keep decisions, sources, plans, and roadmap material beside the owning PRD. | One PRD hub exposes its full context without lifecycle-root scattering. | Cross-PRD ownership is more common than PRD ownership. |
| ${today} | Preserve lifecycle roots as read-only compatibility material. | Existing projects remain usable without making old paths the write contract. | Compatibility cost exceeds preservation value. |
`,
};

export const v2DefaultStarterFilePaths = new Set(Object.keys(v2StarterFiles));
