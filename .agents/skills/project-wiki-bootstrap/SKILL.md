---
name: project-wiki-bootstrap
description: Compatibility entry point for the Project Librarian service- and PRD-centered planning wiki.
metadata:
  short-description: Project Librarian compatibility skill
---

# Project Wiki Bootstrap

This compatibility skill delegates to the `project-librarian` contract and runner.

- Use `init` for a fresh setup and `update` to refresh managed setup while preserving existing wiki content.
- Use `install`; `install-skill` remains a compatibility alias.
- Organize durable knowledge through `service -> PRD/initiative -> document area -> focused artifact`.
- Keep unresolved material in `wiki/inbox/` and retired recoverable material in `wiki/90-archive/`.
- Use `--lint`, `--link-check`, `--quality-check`, and `--doctor` for wiki quality.
- Use `--query`, `--wiki-impact`, and `--wiki-neighborhood` for bounded wiki retrieval.
- Do not create new content in legacy lifecycle roots. Existing content there is read-only compatibility material.

Prefer the local runner, read `wiki/startup.md` and `wiki/index.md` first, and follow the full `project-librarian` skill for detailed operating rules.
