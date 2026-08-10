# Codex Project Instructions

<!-- PROJECT-WIKI-FIRST:START -->

## Wiki-First Planning

This project uses `./wiki` as the durable project-planning source of truth.

At the start of every session:

1. Review `wiki/startup.md` for compact current context.
2. Review `wiki/index.md` as the router for which files to read next.
3. Follow `wiki/00-index/` into the owning service, PRD hub, shared area, portfolio route, or compatibility page; read detailed pages on demand only when the current question needs them.

### Startup TL;DR (auto-synced for non-interactive sessions; source: wiki/startup.md)

- Current release: `project-librarian@0.6.4`, shipped at tag `v0.6.4` (HEAD `3750622`).
- Updater fix: `update` now limits implicit targets to managed or already-present agent surfaces; a bare `.codex/` updates Codex only, and an undetectable target fails before writes.
- Current direction: keep `wiki/index.md` as the writable router and use `service -> PRD/initiative -> document area` as the primary knowledge structure; derive topology from links, IDs, metadata, page class, and router depth.
- Do not revive the graph visualizer as primary UX. The accepted path is bounded, answer-shaped retrieval plus warning-only topology diagnostics.
- New surface: `--wiki-neighborhood <target>` returns relevant wiki pages, backlinks, decision citations, and read order without mutating files.
- New topology warnings: `hub-overload`, `weak-authority-route`, `missing-evidence-link`, `stale-fanout`.
- Release evidence: local release:check, PR checks, post-merge main checks, native helper publish workflow, protected approval, trusted npm publish, and npm latest verification all passed.
- Benchmark claims remain evidence-scoped; latest public wiki-routing claim is the 2026-06-29 run on `ae79390`.
- Project truth: `wiki/10-services/` and `wiki/20-shared/`; portfolio work: `wiki/30-portfolio/`; PRD hubs: `wiki/00-index/prd-registry.md`; wiki operations remain under `wiki/meta/`; legacy lifecycle roots are read-only compatibility material.
- Session start reads only this file and `wiki/index.md`; route into details on demand.

During conversation:

- Update `./wiki` in the same turn when project planning content is added, changed, or removed.
- Classify new project-planning content with `wiki/meta/document-taxonomy.md` before writing or consolidating it.
- Do not store non-project LLM memory, assistant preferences, collaboration reminders, or workflow instructions in project wiki canonical or decision docs.
- Follow `wiki/AGENTS.md` for detailed rules when editing files under `wiki/`.
- Treat broad maintenance/improvement automation requests that do not name a concrete command (for example "improve this project", "start improvement automation") as analyze-first project work, not as a plain bootstrap/update. Inspect repo, wiki, CI, test, release, dependency, and code-structure evidence; produce a ranked backlog with evidence and verification paths; persist PRD-specific work in the owning `11-plans/` area or cross-PRD work in `wiki/30-portfolio/`; then execute safe high-priority items with tests.
- Do not execute worktree-controlled commit hooks for wiki trailers; add trailers explicitly when needed.
- Wiki decision documents are authoritative for project decisions: do not re-verify them against the repository unless directly conflicting code evidence appears, since the `--doctor` router-truth rule guards against stale routers.
- Code-evidence tool and report outputs (`--code-impact`, `--code-report`, and the `project-librarian mcp` tools) are authoritative for code-structure questions: do not re-verify them with repo-wide greps unless `--code-status`/`code_status` reports staleness; on small repos below the measured scale threshold, prefer direct reads over these tools for simple lookups (measured cheaper at small scale).
- Guidance-refinement claims are evidence-scoped: do not promote or claim an agent-instruction improvement unless a local guidance-probe or equivalent report has a passed claim gate with complete measured pairs, variant digests, and zero read-only file changes where requested; otherwise describe it as an unverified candidate.
<!-- PROJECT-WIKI-FIRST:END -->

## Project Librarian Maintainer Routing

For this repository's benchmark/guidance work, evidence routing is measured and repo-scoped: benchmark evidence, guidance-probe, claim-gate, or read-only benchmark questions should start from [PRD-005 benchmark and release hub](wiki/10-services/project-librarian/prds/PRD-005-benchmark-release/README.md); benchmark runner localization should include `benchmarks/codex-llm-metrics.js`, `benchmarks/lib/llm-report.js`, and `benchmarks/lib/codex-jsonl.js`; router-truth/stale-index questions should include `wiki/00-index/README.md`, `wiki/index.md`, `wiki/meta/document-taxonomy.md`, `--doctor`, and `--code-status`/`code_status`.

## Local Private Instructions

If `AGENTS.local.md` exists in this directory, read it at session start and follow it.
