"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultStarterFilePaths = exports.starterFiles = exports.v2DefaultStarterFilePaths = exports.v2StarterFiles = exports.documentTaxonomyV2 = exports.decisionPolicyV2 = exports.wikiOperatingModelV2 = exports.documentTaxonomy = exports.decisionPolicy = exports.wikiOperatingModel = exports.inboxIndexBlock = exports.glossaryIndexBlock = exports.glossary = exports.index = exports.startup = exports.metadata = exports.wikiAgentsSection = exports.cursorRule = exports.geminiSection = exports.claudeSection = exports.STARTUP_TLDR_MAX_CHARS = exports.startupTldrSyncLabel = exports.guidanceClaimEvidenceContract = exports.codeEvidenceTrustContract = exports.wikiTrustContract = void 0;
exports.extractStartupTldr = extractStartupTldr;
exports.agentsSection = agentsSection;
const workspace_1 = require("./workspace");
// B4 (gated on B2, which ships in the same phase): a single-sentence trust
// contract in the managed AGENTS.md block. It is the substitution mechanism that
// stops repo-wide re-verification greps; the --doctor router-truth rule (B2)
// guards against trusting a stale router.
exports.wikiTrustContract = "Wiki decision documents are authoritative for project decisions: do not re-verify them against the repository unless directly conflicting code evidence appears, since the `--doctor` router-truth rule guards against stale routers.";
// B4 analogue for code evidence: a single-sentence trust contract making the
// code-evidence tool/report outputs authoritative for code-structure questions,
// gated on the same staleness check the tools surface (`--code-status` /
// `code_status`). Mirrors wikiTrustContract scale; kept budget-conscious. The
// closing clause is the scale-conditional guidance (2026-06-12 decision, stageR1
// evidence): on small repos simple lookups measured cheaper via direct reads.
exports.codeEvidenceTrustContract = "Code-evidence tool and report outputs (`--code-impact`, `--code-report`, and the `project-librarian mcp` tools) are authoritative for code-structure questions: do not re-verify them with repo-wide greps unless `--code-status`/`code_status` reports staleness; on small repos below the measured scale threshold, prefer direct reads over these tools for simple lookups (measured cheaper at small scale).";
// Guidance-refinement analogue for agent-instruction changes. The measured
// evidence is scoped to local probe reports, not transferred across models,
// surfaces, repos, or user projects without their own passing claim gate.
exports.guidanceClaimEvidenceContract = "Guidance-refinement claims are evidence-scoped: do not promote or claim an agent-instruction improvement unless a local guidance-probe or equivalent report has a passed claim gate with complete measured pairs, variant digests, and zero read-only file changes where requested; otherwise describe it as an unverified candidate.";
// B1 fallback: label for the auto-synced startup TL;DR sub-block embedded in the
// managed AGENTS.md marker section. Non-interactive `codex exec` does not run
// SessionStart hooks (measured 2026-06-10), so AGENTS.md is the only startup
// context carrier there; the sync stays TL;DR-only per token discipline.
exports.startupTldrSyncLabel = "Startup TL;DR (auto-synced for non-interactive sessions; source: wiki/startup.md)";
// Hard cap on the extracted TL;DR text embedded in AGENTS.md. The startup hook
// budget is 3500 chars for the full wiki/startup.md; the TL;DR sub-section must
// stay well under that so the managed block remains token-efficient. 2000 chars is
// a documented hard bound: it leaves headroom for frontmatter, other sections, and
// the AGENTS.md surrounding content. Per the no-fallback rule, we NEVER truncate —
// if the extracted bullets exceed this limit the sync fails loudly so the author
// knows to trim the TL;DR.
exports.STARTUP_TLDR_MAX_CHARS = 2000;
// Extract the `## TL;DR` bullet list from a startup.md body (TL;DR section ONLY —
// never Recent Decisions or Project State). Returns the `- ` bullet lines between
// the `## TL;DR` heading and the next `## ` heading. Throws loudly when the
// startup body has no `## TL;DR` section, that section has no bullets, or the
// extracted text exceeds STARTUP_TLDR_MAX_CHARS (no fallback, no silent truncation).
function extractStartupTldr(startupMarkdown) {
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
    if (result.length > exports.STARTUP_TLDR_MAX_CHARS) {
        throw new Error(`cannot sync startup TL;DR into AGENTS.md: extracted TL;DR is ${result.length} chars, which exceeds the ${exports.STARTUP_TLDR_MAX_CHARS}-char limit; trim the ## TL;DR section in wiki/startup.md`);
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
function agentsSection(startupTldr) {
    return `<!-- PROJECT-WIKI-FIRST:START -->
## Wiki-First Planning

This project uses \`./wiki\` as the durable project-planning source of truth.

At the start of every session:

1. Review \`wiki/startup.md\` for compact current context.
2. Review \`wiki/index.md\` as the router for which files to read next.
3. Follow \`wiki/00-index/\` into the owning service, PRD hub, shared area, portfolio route, or compatibility page; read detailed pages on demand only when the current question needs them.

### ${exports.startupTldrSyncLabel}

${startupTldr}

During conversation:

- Update \`./wiki\` in the same turn when project planning content is added, changed, or removed.
- Classify new project-planning content with \`wiki/meta/document-taxonomy.md\` before writing or consolidating it.
- Do not store non-project LLM memory, assistant preferences, collaboration reminders, or workflow instructions in service, PRD, shared, or decision docs.
- Follow \`wiki/AGENTS.md\` for detailed rules when editing files under \`wiki/\`.
- Treat broad maintenance/improvement automation requests that do not name a concrete command (for example "improve this project", "start improvement automation", or "개선 자동화 시작해") as analyze-first project work, not as a plain bootstrap/update. Inspect repo, wiki, CI, test, release, dependency, and code-structure evidence; produce a ranked backlog with evidence and verification paths; persist PRD-specific plans in the PRD's \`11-plans/\` area and cross-PRD plans in \`wiki/30-portfolio/\`; then execute safe high-priority items with tests.
- Do not execute worktree-controlled commit hooks for wiki trailers; add trailers explicitly when needed.
- ${exports.wikiTrustContract}
- ${exports.codeEvidenceTrustContract}
- ${exports.guidanceClaimEvidenceContract}
<!-- PROJECT-WIKI-FIRST:END -->`;
}
exports.claudeSection = `<!-- PROJECT-WIKI-CLAUDE:START -->
# Claude Code Project Instructions

@AGENTS.md

## Claude Code Notes

Claude Code reads \`CLAUDE.md\`, not \`AGENTS.md\`, so this file imports \`AGENTS.md\` to share the same wiki-first planning contract with Codex and other agents. Bootstrap also installs a Claude Code \`SessionStart\` hook in \`.claude/settings.json\` for compact wiki startup context.

At session start, follow the imported instructions: review \`wiki/startup.md\` and \`wiki/index.md\` first, then route through the owning service or PRD hub on demand.
<!-- PROJECT-WIKI-CLAUDE:END -->`;
exports.geminiSection = `<!-- PROJECT-WIKI-GEMINI:START -->
# Gemini CLI Project Instructions

@AGENTS.md

## Gemini CLI Notes

Gemini CLI reads \`GEMINI.md\` by default, so this file imports \`AGENTS.md\` to share the same wiki-first planning contract with Codex, Claude Code, Cursor, and other agents.

At session start, follow the imported instructions: review \`wiki/startup.md\` and \`wiki/index.md\` first, then route through the owning service or PRD hub on demand.
<!-- PROJECT-WIKI-GEMINI:END -->`;
exports.cursorRule = `---
alwaysApply: true
---

# Project Librarian Wiki-First Planning

Use the repository root \`AGENTS.md\` as the project-wide instruction source.

@AGENTS.md
`;
exports.wikiAgentsSection = `<!-- PROJECT-WIKI-INTERNAL:START -->
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
- \`meta/\` contains wiki operating rules, decision policy, bootstrap, lint, hook, and migration decisions.
- \`inbox/\` and migration inbox files contain candidates, not canonical truth.
- Do not store non-project LLM memory, assistant preferences, collaboration reminders, or workflow instructions in project truth or decision docs; use root \`AGENTS.md\`, compatibility instruction files, hooks, rules, or skills instead.
- During migration review, preserve useful meaning while converting it to the current wiki structure. Legacy files, sections, blocks, and wording may be retained when review confirms they belong in the new topic shape and remain current project truth. Do not link to or cite \`wiki_legacy*\` from the new wiki; cite current-project evidence when possible and keep unresolved or ambiguous material in migration inboxes.

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
- Put a compact TL;DR near the top of service, PRD, shared, decision, meta, source, inbox, and migration pages.
- Update \`startup.md\` when session-start summary, recent important decisions, open questions, routing hints, or project-language choice changes.
- Update \`index.md\` when adding, moving, removing, or materially changing wiki pages.
- Keep decision records in the owning PRD's \`09-decisions/\` area; use Decision Packs or ADRs according to impact.
- Initialize \`20-shared/glossary.md\` when terminology becomes useful.
- Keep migration inbox statuses as \`pending\`, \`adopted\`, \`rejected\`, \`resolved\`, or \`needs-human-review\`.

Commit rules:

- Follow the repository's commit-message policy when one exists.
- Do not execute worktree-controlled commit hooks for wiki trailers; add trailers explicitly when needed.
- If bootstrap was run with \`--no-git-config\`, hook files are installed but \`core.hooksPath\` is not changed.
- Hand-write wiki trailers when project policy requires them; keep them accurate and evidence-backed.
<!-- PROJECT-WIKI-INTERNAL:END -->`;
const metadata = (scope, budget, decisionRef, trigger, status = "active", options = {}) => `---
status: ${status}
updated: ${workspace_1.today}
scope: ${scope}
type: ${options.type ?? scope}
read_budget: ${budget}
decision_ref: ${decisionRef}
review_trigger: ${trigger}
owner: ${options.owner ?? "unassigned"}${options.service ? `\nservice: ${options.service}` : ""}${options.prdId ? `\nprd_id: ${options.prdId}` : ""}
---
`;
exports.metadata = metadata;
exports.startup = `${(0, exports.metadata)("startup-router", "short", "wiki/meta/wiki-ops-v2-decisions.md", "session-start summary, service/PRD routing, language policy, or open project state changes", "active", { type: "router" })}
# Startup Context

## TL;DR

- This project is in an initial planning state until services and PRDs are registered.
- Project truth lives under \`wiki/10-services/\` and \`wiki/20-shared/\`; cross-PRD future work lives in \`wiki/30-portfolio/\`.
- Start at \`wiki/00-index/\`, then follow service -> PRD/initiative -> document area.
- Wiki operating rules and wiki operating decisions live in \`wiki/meta/\`.
- At session start, read only this file and \`wiki/index.md\` first; use the index as a route table, open matching detail files directly, and avoid broad repo/wiki search unless no route matches.
- Existing lifecycle roots, when present, are compatibility pages for reading and migration only.
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
exports.index = `${(0, exports.metadata)("wiki-router", "short", "wiki/meta/wiki-ops-v2-decisions.md", "service, PRD, document area, or routing link changes", "active", { type: "router" })}
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
exports.glossary = `${(0, exports.metadata)("shared-glossary", "medium", "wiki/meta/wiki-ops-v2-decisions.md", "shared terms, roles, states, permissions, events, entities, API names, DB names, or UI labels change", "active", { type: "shared" })}
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
exports.glossaryIndexBlock = `<!-- PROJECT-WIKI-GLOSSARY:START -->
## Glossary

- [[20-shared/glossary]]
  - Read: terms, roles, states, permissions, events, API/DB/UI names, naming conflicts.
  - Update: core term is added, renamed, or deprecated.
  - Token budget: medium.
<!-- PROJECT-WIKI-GLOSSARY:END -->`;
exports.inboxIndexBlock = `<!-- PROJECT-WIKI-INBOX:START -->
## Inbox

- [[inbox/project-candidates]]
  - Read: captured project candidates not yet adopted, classified by service, PRD, and type when known.
  - Update: \`--capture-inbox\` adds a candidate or its ownership/status changes.
  - Token budget: on-demand.
<!-- PROJECT-WIKI-INBOX:END -->`;
exports.wikiOperatingModel = `${(0, exports.metadata)("wiki-meta", "medium", "wiki/meta/wiki-ops-v1-decisions.md", "wiki operating rules, hook behavior, bootstrap behavior, language policy, or token policy changes")}
# Wiki Operating Model

## TL;DR

- This wiki keeps project-planning knowledge as durable markdown.
- Codex, Claude Code, Cursor, and Gemini CLI session-start hooks inject only \`wiki/startup.md\` and \`wiki/index.md\`.
- Detailed canonical and decision files are read on demand.
- Roadmaps and plans are separate from canonical truth; canonical pages keep the current accepted state.
- Root \`AGENTS.md\` keeps the project-wide wiki-first contract; \`wiki/AGENTS.md\` keeps detailed wiki editing rules.
- Operating documents generated by bootstrap are English by default.
- Project canonical content language is selected from user/project context, not hardcoded by this bootstrap.
- Search, index refresh, inbox capture, and lifecycle checks are explicit script modes.
- New project content is classified through [[meta/document-taxonomy]] before it is written or consolidated.

## Purpose

This wiki prevents project-planning knowledge from being trapped in one-off conversations. It gives humans and LLM agents a compact startup path plus durable source-of-truth documents.

## Applied Source Pattern

Karpathy's LLM Wiki pattern favors a continuously maintained markdown wiki over repeatedly rebuilding answers from scratch. This project applies that pattern to project planning.

## Layers

1. Sources: external docs, links, user notes, and evidence summaries.
2. Canonical project truth: current accepted specs, contracts, policies, and operating state under \`wiki/canonical/\`.
3. Roadmaps: broad future scope, priority queues, and milestone sequences under \`wiki/roadmaps/\` or an external tracker.
4. Plans: detailed execution plans for roadmap items under \`wiki/plans/\` or an external tracker.
5. Project decisions: rationale, rejected alternatives, and revisit triggers under \`wiki/decisions/\`.
6. Startup context: compact session summary in \`wiki/startup.md\`.
7. Router: read/update/token-budget guidance in \`wiki/index.md\`.
8. Wiki meta: operating rules, decision policy, bootstrap, migration, lint, and language policy under \`wiki/meta/\`.

## Content Classification Procedure

Before writing or reorganizing project-planning content:

1. Identify the content's lifecycle area with [[meta/document-taxonomy]].
2. Decide whether the content is current truth, roadmap, detailed plan, decision rationale, source evidence, an unresolved candidate, or a wiki operating rule.
3. Write current truth to the narrowest relevant \`canonical/\` page, broad future scope to \`roadmaps/\`, detailed execution plans to \`plans/\`, decision rationale to \`decisions/\`, source notes to \`sources/\`, candidates to \`inbox/\`, and wiki operating rules to \`meta/\`.
4. Split multi-area inputs instead of making one catch-all document.
5. Link upstream and downstream pages when the content derives from another artifact or produces another artifact.

Do not treat \`canonical/project-brief.md\` as a default dumping ground. It should summarize direction, audience, scope, and success criteria; detailed product, policy, UX, data, engineering, QA, release, or operations truth should move into focused pages when it grows.

Do not treat \`wiki/canonical/\` as a plan archive. If a whole document is mainly about future scope, implementation sequence, migration wave, branch status, or work result log, keep it outside canonical truth and link it from the relevant current-spec page only when readers need that context. When the work is done, update canonical truth and then remove completed roadmap/plan content after rationale and evidence are preserved in their proper places.

## Language Policy

- Bootstrap-generated operating documents are English.
- Project canonical content should use the language that best matches the user's language, project context, and surrounding materials.
- Keep a consistent project language once selected.
- If the user explicitly requests a language, that request wins.

## Query Procedure

Start with \`wiki/startup.md\` and \`wiki/index.md\`. Then select only relevant canonical, decision, meta, or source files using the "read when" rules.

Use keyword query when explicit search is useful:

\`\`\`bash
node dist/init-project-wiki.js --query "search terms"
\`\`\`

## Token Discipline

- Do not inject long canonical bodies or full decision logs into startup context.
- Put a compact TL;DR near the top of knowledge pages.
- Keep read/update/token-budget hints in \`wiki/index.md\`.
- Use \`decisions/log.md\` for accumulated timestamps and surface only important recent decisions in \`decisions/recent.md\` or \`startup.md\`.

## Git Hook Setup

- The script installs \`.githooks/prepare-commit-msg\` and \`.githooks/wiki-commit-trailers.js\`.
- \`.githooks/prepare-commit-msg\` is intentionally passive and must not execute worktree-controlled scripts.
- By default, git repositories with an unset \`core.hooksPath\` are configured with \`git config core.hooksPath .githooks\`.
- Existing \`core.hooksPath\` values are preserved so an existing hook chain is not replaced.
- Run bootstrap with \`--no-git-config\` to install hook files without changing git config.
`;
exports.decisionPolicy = `${(0, exports.metadata)("wiki-meta", "medium", "wiki/meta/wiki-ops-v1-decisions.md", "project decision recording levels or ADR criteria change")}
# Decision Policy

## TL;DR

- Canonical docs hold current agreement; project decision docs hold rationale and history.
- Simple project changes update canonical docs only.
- Trivial decisions that need timing go into \`decisions/log.md\`.
- Related decisions can be grouped into a Decision Pack.
- Heavy decisions use a Full ADR.
- Wiki operating decisions belong in \`wiki/meta/\`, not project decision history.

## 1. Canonical Only

Use only \`wiki/canonical/\` for simple spec confirmation, current behavior descriptions, reversible wording edits, and low-context changes.

## 2. One-Line Log

Use \`wiki/decisions/log.md\` when the main value is timestamp tracking.

\`\`\`md
- YYYY-MM-DD | area | decision | canonical: [[canonical/example]]
\`\`\`

## 3. Decision Pack

Use a Decision Pack when several related choices share one topic.

| Date | Decision | Rationale | Rejected Alternative | Revisit Trigger | Canonical Link |
| --- | --- | --- | --- | --- | --- |

## 4. Full ADR

Use a Full ADR when the decision affects product direction, architecture, public API, data model, security/permissions, SEO contracts, high migration cost, or a likely future challenge.

## Token Rules

- Put a TL;DR near the top of canonical docs.
- Do not inject full canonical or decision bodies into startup context.
- Read long decision files only when \`wiki/index.md\` routing says they are relevant.
`;
exports.documentTaxonomy = `${(0, exports.metadata)("wiki-meta", "medium", "wiki/meta/wiki-ops-v1-decisions.md", "wiki information architecture, documentation categories, or content classification rules change")}
# Document Taxonomy

## TL;DR

- Classify new project-planning content before writing it into the wiki.
- Classify into \`canonical/\`, \`roadmaps/\`, \`plans/\`, \`decisions/\`, \`sources/\`, \`inbox/\`, or \`meta/\`.
- Keep \`canonical/project-brief.md\` compact; move details into focused pages.
- Keep future work outside canonical; canonical pages may include brief change pointers.
- Preserve derivation links: evidence -> strategy -> requirements -> design/data/engineering -> QA -> release/operations -> feedback.

## Top-Level Flow

\`\`\`text
0. Governance
  -> 1. Research and evidence
    -> 2. Strategy and business model
      -> 3. Product scope and requirements
        -> 4. Policies and rules
        -> 5. UX and content
        -> 6. Design
        -> 7. Data and analytics
        -> 8. Engineering
          -> 9. Security, legal, compliance
          -> 10. QA and verification
            -> 11. Release and operations
              -> 12. Business operations
                -> 13. Improvement, migration, and end-of-life
                  -> roadmap -> plan -> canonical update
\`\`\`

## Storage Decision

| Content Type | Store In | Notes |
| --- | --- | --- |
| Current project truth | \`wiki/canonical/\` | Accepted spec, contract, policy, or operating state. |
| Roadmap, milestone sequence, or priority queue | \`wiki/roadmaps/\` or tracker | Broad future scope, not canonical truth. |
| Detailed plan, proposal, migration, or task sequence | \`wiki/plans/\` or external tracker | Execution detail, not canonical truth. |
| Why a choice was made | \`wiki/decisions/\` | Use log, Decision Pack, or ADR by impact. |
| Source material or summarized evidence | \`wiki/sources/\` | Keep links, checked dates, and applicability. |
| Unreviewed or ambiguous material | \`wiki/inbox/\` | Do not treat as canonical truth. |
| Wiki operation, taxonomy, hooks, migration, lint, language rules | \`wiki/meta/\` | Keep outside project canonical truth. |
| Better external source of truth | External artifact plus a concise wiki route | Examples: Figma, OpenAPI, ERD, Jira, code. |

## Canonical vs Roadmap vs Plan Boundary

\`wiki/canonical/\` is for the state readers should treat as true now. A page mainly about future change, implementation sequence, migration wave, branch status, or work log is not canonical truth.

Use \`wiki/roadmaps/\` for broad ordered future work. Use \`wiki/plans/\` for one roadmap item's details. Put only short planned-change notes in canonical pages.

After acceptance or release, rewrite canonical truth. Move rationale to \`wiki/decisions/\` and evidence to \`wiki/sources/\`, release notes, or reports. Then delete completed roadmap/plan content unless external retention is required.

## Lifecycle Areas

| Area | Put Here | Usually Derives From | Usually Produces |
| --- | --- | --- | --- |
| 0. Governance | source-of-truth map, owners, RACI, approval flow, change rules, glossary, state dictionary, assumptions, risk register | team/process constraints | routing, ownership, conflict resolution |
| 1. Research | market, competitor, user interviews, VOC, analytics, legal/regulatory, technical feasibility, cost, vendor, accessibility research | raw discovery | strategy, risks, sources |
| 2. Strategy | service overview, vision, problem, target users, personas, jobs-to-be-done, value offer, positioning, business model, KPI/OKR, success/stop criteria, committed roadmap summary, MVP, non-goals | research | PRD, roadmap, scope |
| 3. Product | PRD, user stories, use cases, priorities, backlog rules, acceptance criteria, feature spec, exceptions, state definitions, notification rules, search/filter/sort rules, admin requirements | strategy and policy | UX, API, data, QA |
| 4. Policy | operations policy, auth/account, permissions, pricing, payment/refund, coupon/credit, content moderation, notifications, retention/deletion, abuse response, support, EOL | business model, law, risks | feature constraints, API rules, CS/ops |
| 5. UX and Content | IA, sitemap, user flow, task flow, screen list, wireframes, screen specs, content model, UX writing, empty/error states, help/FAQ, localization, SEO, accessibility criteria | product and policy | design, frontend, QA |
| 6. Design | brand guide, design principles, design system, component spec, responsive rules, interaction spec, prototype, design QA | UX and brand | UI implementation, design QA |
| 7. Data and Analytics | ERD, data dictionary, classification, ownership/stewardship, event taxonomy, metric definitions, funnels, data quality, lineage, export/import, anonymization, dashboards | product, policy, KPI | schemas, events, reports |
| 8. Engineering | architecture, technology decisions, API/OpenAPI, integrations, webhooks/idempotency, state machines, jobs/cron, error codes, env vars, secrets, local dev, conventions, branch/release strategy, CI/CD, feature flags, dependencies, migrations, performance, scalability, FinOps | product, UX, data, policy | implementation and verification |
| 9. Security/Legal | security requirements, threat model, privacy rules, privacy impact, terms, privacy policy, audit logs, permission history, internal access controls, key rotation, vulnerability response, licenses, vendor and DPA documents | data, architecture, law | controls, tests, release gates |
| 10. QA | test strategy, QA scenarios, test cases, regression checklist, UAT, browser/device matrix, accessibility tests, performance tests, security tests, data quality tests, design QA, quality gates | requirements, design, engineering | release approval |
| 11. Release/Ops | current release policy, deployment procedure, rollback, release notes, operator manual, runbooks, monitoring, observability, SLO/SLA, on-call/escalation, incident response, backup/restore, DR/BCP, recurring checks | QA and infrastructure | stable operation |
| 12. Business Ops | CS macros, support policy, training, sales/adoption guide, CRM rules, onboarding playbook, churn/offboarding, admin operations, communication templates, revenue recognition, tax/invoice, partner operations | policy, release, sales motion | customer-facing operation |
| 13. Improvement/EOL | VOC summary, retrospectives, experiments, experiment results, cohort/retention analysis, feature deprecation, migration/data transfer, service end-of-life | operations and analytics | next PRD, policy, roadmap |

## Writing Rule

When a new note arrives:

1. Identify the lifecycle area and storage location.
2. Decide whether content is current truth, roadmap, plan, decision rationale, evidence, candidate, or wiki operating rule.
3. Update an existing focused canonical page only when the content changes current truth.
4. Create a new focused page only when the topic is durable, likely to be read independently, or too large for its current page.
5. If the document is future-oriented, store broad scope in \`roadmaps/\` and detailed execution in \`plans/\`.
6. Add an \`index.md\` route when the page becomes durable.
7. Add upstream/downstream links in prose or tables when one artifact derives from another.
8. Record decision rationale separately when the change explains why the project chose one option over another.
9. When roadmap/plan work is done, update canonical truth, preserve rationale/evidence, then remove completed roadmap/plan content.

## Page Shape

Use this shape for focused canonical pages unless a domain-specific shape is clearly better:

\`\`\`md
---
status: active
updated: YYYY-MM-DD
scope: project-canonical
read_budget: short|medium|on-demand
decision_ref: none|wiki/decisions/...
review_trigger: what should cause this page to change
---

# <Topic>

## TL;DR

- Current agreement in one to five bullets.

## Current Truth

## Upstream Inputs

## Downstream Artifacts

## Open Questions
\`\`\`
`;
// V2 is the only write contract used by fresh bootstrap and update. The legacy
// exports below remain available solely so migration can recognize old generated
// starters without recreating lifecycle-root directories.
exports.wikiOperatingModelV2 = `${(0, exports.metadata)("wiki-meta", "medium", "wiki/meta/wiki-ops-v2-decisions.md", "service/PRD structure, hooks, bootstrap, migration, language, or token policy changes", "active", { type: "wiki-meta" })}
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

Queries, links, impact, neighborhood, migration review, and coverage continue to read existing \`canonical/\`, \`roadmaps/\`, \`plans/\`, \`decisions/\`, and \`sources/\` pages. New writes and migration targets use only the v2 writable roots.
`;
exports.decisionPolicyV2 = `${(0, exports.metadata)("wiki-meta", "medium", "wiki/meta/wiki-ops-v2-decisions.md", "decision levels, ownership, or ADR criteria change", "active", { type: "wiki-meta" })}
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
4. Full ADR: product direction, architecture, public API, data model, security, permissions, compliance, or migration cost is material.
`;
exports.documentTaxonomyV2 = `${(0, exports.metadata)("wiki-meta", "medium", "wiki/meta/wiki-ops-v2-decisions.md", "service/PRD information architecture or classification rules change", "active", { type: "wiki-meta" })}
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

Unknown ownership stays in \`inbox/\` or migration review with \`owner: unassigned\` and \`needs-human-review\`; it does not become current truth automatically.
`;
exports.v2StarterFiles = {
    "wiki/README.md": `${(0, exports.metadata)("wiki-entry", "short", "wiki/meta/wiki-ops-v2-decisions.md", "top-level wiki structure changes", "active", { type: "wiki-entry" })}
# Project Wiki

Start with [[startup]], [[index]], or [[00-index/README]]. Durable product knowledge is organized by owning service and PRD.
`,
    "wiki/00-index/README.md": `${(0, exports.metadata)("wiki-index", "short", "wiki/meta/wiki-ops-v2-decisions.md", "service or PRD routing changes", "active", { type: "router" })}
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
    "wiki/00-index/service-map.md": `${(0, exports.metadata)("service-registry", "short", "wiki/meta/wiki-ops-v2-decisions.md", "a service is added, renamed, retired, or changes ownership", "active", { type: "router" })}
# Service Map

## TL;DR

- No services are registered yet.
- Add a stable lowercase service slug and link its hub before creating PRDs.

| Service | Owner | Hub | Status |
| --- | --- | --- | --- |
| none | - | - | - |
`,
    "wiki/00-index/prd-registry.md": `${(0, exports.metadata)("prd-registry", "short", "wiki/meta/wiki-ops-v2-decisions.md", "a PRD is added, renamed, retired, or changes ownership/status", "active", { type: "router" })}
# PRD Registry

## TL;DR

- No PRDs are registered yet.
- PRD IDs are stable; rename only the slug portion of \`PRD-NNN-slug\`.

| PRD ID | Service | Owner | Hub | Status |
| --- | --- | --- | --- | --- |
| none | - | - | - | - |
`,
    "wiki/01-governance/README.md": `${(0, exports.metadata)("documentation-governance", "medium", "wiki/meta/wiki-ops-v2-decisions.md", "source-of-truth, ownership, metadata, or review rules change", "active", { type: "governance" })}
# Documentation Governance

## TL;DR

- Register service and PRD ownership before creating durable product pages.
- Current truth lives in service, PRD, or shared areas; plans, decisions, and sources remain beside their owner.
- Existing lifecycle roots are read-only compatibility pages.

See [[meta/operating-model]], [[meta/document-taxonomy]], and [[meta/decision-policy]].
`,
    "wiki/10-services/README.md": `${(0, exports.metadata)("service-registry", "short", "wiki/meta/wiki-ops-v2-decisions.md", "service hubs are added, moved, or retired", "active", { type: "service-registry" })}
# Services

## TL;DR

- No service hubs exist yet.
- Create \`10-services/<service>/README.md\` and \`service-overview.md\` only after registration.
`,
    "wiki/20-shared/README.md": `${(0, exports.metadata)("shared-index", "short", "wiki/meta/wiki-ops-v2-decisions.md", "shared contracts or terminology change", "active", { type: "shared" })}
# Shared

## TL;DR

- Keep only contracts or terminology owned by more than one service or PRD here.
- Prefer the narrowest service or PRD owner when sharing is not real.
`,
    "wiki/30-portfolio/README.md": `${(0, exports.metadata)("portfolio", "medium", "wiki/meta/wiki-ops-v2-decisions.md", "cross-PRD priorities, sequencing, or dependencies change", "active", { type: "portfolio" })}
# Portfolio

## TL;DR

- No cross-PRD roadmap items are registered yet.
- PRD-local plans belong in the owning PRD's \`11-plans/\` area.
`,
    "wiki/90-archive/README.md": `${(0, exports.metadata)("archive", "on-demand", "wiki/meta/wiki-ops-v2-decisions.md", "retention rules or archived routes change", "active", { type: "archive" })}
# Archive

## TL;DR

- Retired material remains recoverable here but is never active truth.
- Record the replacement route and retirement reason when archiving a page.
`,
    "wiki/meta/document-taxonomy.md": exports.documentTaxonomyV2,
    "wiki/meta/wiki-ops-v2-decisions.md": `${(0, exports.metadata)("wiki-meta-decisions", "medium", "self", "service/PRD wiki operating decisions change", "active", { type: "wiki-meta" })}
# Wiki Operations v2 Decisions

## TL;DR

- The accepted write model is service -> PRD/initiative -> document area.
- Lifecycle roots remain read-compatible but are not created or accepted as new targets.
- Fresh bootstrap creates neutral hubs and does not invent a service or PRD.

Status: accepted

| Date | Decision | Rationale | Revisit Trigger |
| --- | --- | --- | --- |
| ${workspace_1.today} | Organize durable knowledge by service and stable PRD ID. | Ownership and retrieval remain local as PRD count grows. | Teams cannot assign stable service or PRD ownership. |
| ${workspace_1.today} | Keep decisions, sources, plans, and roadmap material beside the owning PRD. | One PRD hub exposes its full context without lifecycle-root scattering. | Cross-PRD ownership is more common than PRD ownership. |
| ${workspace_1.today} | Preserve lifecycle roots for reads and migration only. | Existing projects remain usable without making old paths the write contract. | Compatibility cost exceeds migration value. |
`,
};
exports.v2DefaultStarterFilePaths = new Set(Object.keys(exports.v2StarterFiles));
exports.starterFiles = {
    "wiki/README.md": `${(0, exports.metadata)("wiki-entry", "short", "wiki/meta/wiki-ops-v1-decisions.md", "top-level wiki structure changes")}
# Project Wiki

This directory is the durable project-planning source of truth. Keep product direction, specs, constraints, terms, and decisions current here.

## Start Here

- [[startup]]
- [[index]]
- [[meta/document-taxonomy]]
`,
    "wiki/canonical/project-brief.md": `${(0, exports.metadata)("project-canonical", "medium", "none", "product direction, audience, scope, success criteria, or language choice changes")}
# Project Brief

## TL;DR

- Current state: product/service topic is not decided yet.
- This file is the current project-planning truth for direction, audience, scope, and success criteria.
- Content language: choose from user/project context and keep it consistent.

## Current State

Product/service topic is not decided yet.

## To Decide

- Problem/opportunity
- Target users
- Core user scenario
- Success criteria
- Key constraints
- Initial scope
`,
    "wiki/canonical/open-questions.md": `${(0, exports.metadata)("project-canonical", "short", "none", "project questions are added, answered, or retired")}
# Open Questions

## TL;DR

- This page tracks unresolved project questions.
- Move answered questions into relevant canonical docs or mark them resolved.

## Product

- What problem should this project solve?
- Who is it for?
- What is the first core scenario?
- What counts as success?

## Operations

- None yet.
`,
    "wiki/canonical/assumptions.md": `${(0, exports.metadata)("project-canonical", "short", "none", "assumptions are added, validated, or retired")}
# Assumptions

## TL;DR

- This page tracks temporary assumptions before they are validated.
- When an assumption becomes true project knowledge, move it into the relevant canonical doc.

## Active

- Product/service topic is not decided yet.

## Retired

- None.
`,
    "wiki/canonical/risks.md": `${(0, exports.metadata)("project-canonical", "short", "none", "project risks are added, mitigated, or resolved")}
# Risks

## TL;DR

- This page tracks project-planning risks and revisit triggers.
- When a risk is resolved, keep the status and evidence.

## Active

| Risk | Impact | Mitigation | Revisit Trigger |
| --- | --- | --- | --- |
| None | - | - | - |

## Resolved

None.
`,
    "wiki/decisions/README.md": `${(0, exports.metadata)("project-decisions", "short", "wiki/meta/decision-policy.md", "project decision structure changes")}
# Decisions

## TL;DR

- This directory preserves project decision history.
- Current valid project specs belong in \`../canonical/\`.
- Wiki operating decisions belong in \`../meta/\`.

This directory preserves project decision history. Current valid project specs belong in \`../canonical/\`.

Wiki operation, hook, bootstrap, lint, migration, and language-policy decisions belong in \`../meta/\`, not here.
`,
    "wiki/decisions/log.md": `${(0, exports.metadata)("project-decisions", "on-demand", "wiki/meta/decision-policy.md", "trivial project decisions need timestamp tracking")}
# Decision Log

## TL;DR

- This page records lightweight timestamped project decisions when timing matters.
- No project decisions have been logged yet.

No project decisions yet.
`,
    "wiki/decisions/recent.md": `${(0, exports.metadata)("project-decisions", "short", "wiki/meta/decision-policy.md", "recent important project decisions change")}
# Recent Decisions

## TL;DR

- Keep only recent important project decisions that may matter at session start.
- Use [[decisions/log]] for full timestamp tracking.

## Decisions

- None yet.
`,
    "wiki/meta/wiki-ops-v1-decisions.md": `${(0, exports.metadata)("wiki-meta-decisions", "medium", "self", "wiki operation, metadata, lint, migration, language policy, or storage-boundary decisions change")}
# Wiki Operations v1 Decisions

## TL;DR

- This Decision Pack records accepted wiki operating choices for project-librarian.
- It covers wiki structure, document taxonomy, startup hook scope, metadata, language policy, git hook behavior, migration review, inbox handling, and canonical/roadmap/plan boundaries.
- Project product decisions belong in \`wiki/decisions/\`, while these operating decisions stay in \`wiki/meta/\`.

Status: accepted
Scope: wiki operation
Canonical: [[meta/operating-model]], [[meta/decision-policy]], [[meta/document-taxonomy]]

| Date | Decision | Rationale | Rejected Alternative | Revisit Trigger | Canonical Link |
| --- | --- | --- | --- | --- | --- |
| ${workspace_1.today} | Keep the wiki root at \`./wiki\`. | Planning docs live with the project. | External docs only. | Another tool cannot read \`./wiki\` or the team needs another path. | [[meta/operating-model]] |
| ${workspace_1.today} | Split \`canonical/\` and \`decisions/\`. | Current truth and decision history are easier to scan when separated. | A single mixed docs directory. | The structure proves too heavy for small projects. | [[meta/decision-policy]] |
| ${workspace_1.today} | Classify new wiki content through a service-lifecycle document taxonomy before writing or consolidating it. | Agents need a structural contract for deciding whether content is strategy, product, policy, UX, design, data, engineering, security/legal, QA, release/ops, business ops, or improvement/EOL truth. | Let agents append new content to whichever existing page is nearby. | The taxonomy becomes too heavy for small projects or repeatedly misroutes content. | [[meta/document-taxonomy]], [[meta/operating-model]] |
| ${workspace_1.today} | Inject only \`startup.md\` and \`index.md\` through Codex, Claude Code, Cursor, and Gemini CLI startup hooks; route detailed files Read On Demand. | Full canonical and decision bodies waste startup tokens. | Always read detailed canonical and decision files first. | Important context is repeatedly missed at startup. | [[startup]], [[index]] |
| ${workspace_1.today} | Use metadata headers on wiki knowledge pages. | Agents and humans can quickly judge status, scope, budget, and review triggers. | Body-only conventions. | Header maintenance costs more than it saves. | [[meta/operating-model]] |
| ${workspace_1.today} | Keep wiki operating docs in \`wiki/meta/\`. | Project truth stays focused on product/project content. | Store operating docs in \`canonical/\` or \`decisions/\`. | Meta docs become hard to discover. | [[meta/operating-model]] |
| ${workspace_1.today} | Split future work into \`roadmaps/\` and \`plans/\`, outside canonical truth. | Roadmaps list broad future scope and sequencing; plans describe detailed execution for one roadmap item; canonical pages should show only the current accepted spec, contract, policy, or operating state. | Store roadmap, improvement, migration, and implementation plans directly in \`canonical/\` as if they were current truth, or mix roadmaps and detailed plans in one directory. | Teams need a different planning directory convention, or plan artifacts become the authoritative source for current behavior. | [[meta/document-taxonomy]], [[meta/operating-model]] |
| ${workspace_1.today} | Remove completed roadmap and plan content after canonical truth, rationale, and evidence are updated. | Completed future-work documents become stale logs once their outcome is reflected in canonical pages, decisions, and evidence artifacts. | Keep completed roadmap/plan documents indefinitely inside the wiki. | Audit, legal, or release process requires retaining completed plan artifacts in a dedicated external system. | [[meta/document-taxonomy]], [[meta/operating-model]] |
| ${workspace_1.today} | Bootstrap-generated operating documents are English by default. | Repository entry points and operating contracts are easier for public users to inspect. | Generate operating docs in a fixed non-English language. | The project intentionally targets a single-language local audience. | [[meta/operating-model]] |
| ${workspace_1.today} | Project canonical content language is chosen from user/project context. | User language and source material should drive project truth, not the bootstrap tool. | Hardcode Korean or English as the canonical content language. | A team requires a fixed language policy. | [[startup]], [[index]] |
| ${workspace_1.today} | Install git hook files but preserve existing \`core.hooksPath\` values and allow \`--no-git-config\`. | Public users may already have a hook chain such as Husky. | Always replace \`core.hooksPath\`. | Users prefer automatic setup and accept the side effect. | [[meta/operating-model]] |
| ${workspace_1.today} | Commit automation writes the \`Wiki-scope\` trailer. | Reviewers should see whether a commit touched startup, canonical docs, decisions, or wiki operations. | Leave wiki impact implicit in the diff. | Trailer format becomes too noisy. | [[meta/operating-model]] |
| ${workspace_1.today} | Migration may mark rows \`needs-human-review\`. | Ambiguous, risky, or high-impact legacy content should not be closed automatically. | Force every migrated row into adopted/rejected/resolved. | Human review queues become too large. | [[meta/operating-model]] |
| ${workspace_1.today} | Capture stores candidates in \`wiki/inbox/\`. | Useful ideas are not lost, but unreviewed content does not become canonical truth. | Save all conversation content directly into canonical docs. | Inbox content is frequently abandoned. | [[meta/operating-model]] |
| ${workspace_1.today} | Session handoff state lives under \`.project-wiki/session/\`. | Last-session operational memory helps resume work, but it is generated local reference data rather than reviewed project truth. | Store rolling execution memory in \`wiki/startup.md\` or canonical pages. | Handoff data needs to become durable project planning truth. | [[meta/operating-model]] |
`,
    "wiki/meta/document-taxonomy.md": exports.documentTaxonomy,
    "wiki/decisions/decision-pack-template.md": `${(0, exports.metadata)("project-decision-template", "short", "wiki/meta/decision-policy.md", "decision pack format changes", "template")}
# <Topic> v<N> Decisions

Status: proposed | accepted | superseded
Scope:
Canonical:

| Date | Decision | Rationale | Rejected Alternative | Revisit Trigger | Canonical Link |
| --- | --- | --- | --- | --- | --- |
| YYYY-MM-DD |  |  |  |  |  |
`,
    "wiki/decisions/full-adr-template.md": `${(0, exports.metadata)("project-decision-template", "short", "wiki/meta/decision-policy.md", "full ADR format changes", "template")}
# ADR: <Title>

Status: proposed | accepted | superseded
Date: YYYY-MM-DD
Canonical:

## Context

## Decision

## Consequences

## Rejected Alternatives

## Revisit Trigger
`,
    "wiki/sources/karpathy-llm-wiki.md": `${(0, exports.metadata)("source-summary", "short", "wiki/meta/wiki-ops-v1-decisions.md", "source interpretation or reference link changes")}
# Karpathy LLM Wiki

## TL;DR

- This pattern favors continuously maintained markdown wiki context over repeatedly reconstructing context from scratch.
- This project applies the pattern to project-planning source-of-truth management.

Source: [karpathy/llm-wiki.md](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)
Checked: ${workspace_1.today}

## Applied Here

- \`wiki/startup.md\` stores compact session context.
- \`wiki/index.md\` routes reads and updates.
- \`wiki/canonical/\` stores current project truth.
- \`wiki/decisions/\` stores project decision history.
- \`wiki/meta/\` stores wiki operating rules and operating decisions.
`,
};
exports.defaultStarterFilePaths = new Set([
    "wiki/README.md",
    "wiki/decisions/README.md",
    "wiki/decisions/log.md",
    "wiki/decisions/recent.md",
    "wiki/meta/document-taxonomy.md",
    "wiki/sources/karpathy-llm-wiki.md",
]);
