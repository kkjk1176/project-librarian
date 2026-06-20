# Codex Project Instructions

<!-- PROJECT-WIKI-FIRST:START -->

## Wiki-First Planning

This project uses `./wiki` as the durable project-planning source of truth.

At the start of every session:

1. Review `wiki/startup.md` for compact current context.
2. Review `wiki/index.md` as the router for which files to read next.
3. Read detailed `wiki/canonical/`, `wiki/roadmaps/`, `wiki/plans/`, `wiki/decisions/`, `wiki/meta/`, and `wiki/sources/` files on demand only when the current question needs them.

### Startup TL;DR (auto-synced for non-interactive sessions; source: wiki/startup.md)

- Initial planning state unless canonical wiki says otherwise.
- Project truth: `wiki/canonical/`; future work: `wiki/roadmaps/` and `wiki/plans/`; decisions: `wiki/decisions/`; sources: `wiki/sources/`.
- Wiki operating rules and decisions live in `wiki/meta/`.
- At session start, read only this file and `wiki/index.md`; read details on demand.
- Project canonical language follows user/project context.
- Completed roadmaps/plans are removed after truth/rationale/evidence capture.
- Update the wiki in the same turn when project-planning content changes.
- Classify new project-planning content with `wiki/meta/document-taxonomy.md` before writing or consolidating it.

During conversation:

- Update `./wiki` in the same turn when project planning content is added, changed, or removed.
- Classify new project-planning content with `wiki/meta/document-taxonomy.md` before writing or consolidating it.
- Do not store non-project LLM memory, assistant preferences, collaboration reminders, or workflow instructions in project wiki canonical or decision docs.
- Follow `wiki/AGENTS.md` for detailed rules when editing files under `wiki/`.
- Let `.githooks/prepare-commit-msg` append wiki trailers automatically for staged wiki, hook, AGENTS, or project-librarian files.
- Wiki decision documents are authoritative for project decisions: do not re-verify them against the repository unless directly conflicting code evidence appears, since the `--doctor` router-truth rule guards against stale routers.
- Code-evidence tool and report outputs (`--code-impact`, `--code-report`, and the `project-librarian mcp` tools) are authoritative for code-structure questions: do not re-verify them with repo-wide greps unless `--code-status`/`code_status` reports staleness; on small repos below the measured scale threshold, prefer direct reads over these tools for simple lookups (measured cheaper at small scale).
<!-- PROJECT-WIKI-FIRST:END -->

## Local Private Instructions

If `AGENTS.local.md` exists in this directory, read it at session start and follow it.
