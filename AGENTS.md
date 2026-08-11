# Codex Project Instructions

<!-- PROJECT-WIKI-FIRST:START -->

## Wiki-First Planning

This project uses `./wiki` as the durable project-planning source of truth.

At the start of every session:

1. Review `wiki/startup.md` for compact current context.
2. Review `wiki/index.md` as the router for which files to read next.
3. Follow `wiki/00-index/` into the owning service, PRD hub, shared area, portfolio route, or compatibility page; read detailed pages on demand only when the current question needs them.

### Startup TL;DR (auto-synced for non-interactive sessions; source: wiki/startup.md)

- Current release: `project-librarian@0.6.4`.
- Public CLI commands are `init`, `update`, and `install`.
- Keep `wiki/index.md` as the writable router and use `service -> PRD/initiative -> document area` as the primary knowledge structure.
- Query, impact, neighborhood, and warning-only topology diagnostics support wiki organization and retrieval.
- Existing lifecycle roots remain read-only compatibility material and are never reorganized automatically.
- Project truth: `wiki/10-services/` and `wiki/20-shared/`; portfolio work: `wiki/30-portfolio/`; PRD hubs: `wiki/00-index/prd-registry.md`; wiki operations remain under `wiki/meta/`; legacy lifecycle roots are read-only compatibility material.
- Session start reads only this file and `wiki/index.md`; route into details on demand.

During conversation:

- Update `./wiki` in the same turn when project planning content is added, changed, or removed.
- Classify new project-planning content with `wiki/meta/document-taxonomy.md` before writing or consolidating it.
- Do not store non-project LLM memory, assistant preferences, collaboration reminders, or workflow instructions in project wiki canonical or decision docs.
- Follow `wiki/AGENTS.md` for detailed rules when editing files under `wiki/`.
- Treat broad maintenance/improvement requests as analyze-first project work. Inspect the relevant repository, wiki, CI, tests, release flow, dependencies, and source structure; produce a ranked backlog with evidence and verification paths; persist PRD-specific work in the owning `11-plans/` area or cross-PRD work in `wiki/30-portfolio/`; then execute safe high-priority items with tests.
- Do not execute worktree-controlled commit hooks for wiki trailers; add trailers explicitly when needed.
- Wiki decision documents are authoritative for project decisions; revisit them only when directly conflicting repository evidence appears or the recorded review trigger fires.
<!-- PROJECT-WIKI-FIRST:END -->

## Project Librarian Maintainer Routing

For router truth and wiki quality questions, start with `wiki/00-index/README.md`, `wiki/index.md`, `wiki/meta/document-taxonomy.md`, and the `--doctor` diagnostics. Prefer direct source and test reads for implementation questions.

## Local Private Instructions

If `AGENTS.local.md` exists in this directory, read it at session start and follow it.
