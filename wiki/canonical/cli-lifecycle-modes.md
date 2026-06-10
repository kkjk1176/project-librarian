---
status: active
updated: 2026-06-10
scope: project-canonical
read_budget: medium
decision_ref: none
review_trigger: diagnostics, routing, search, inbox, prune, glossary, or skill install modes change
---

# CLI Lifecycle Modes

## TL;DR

- This page owns wiki lifecycle mode behavior that is not specific to GitHub issue reporting, migration, hooks, or code evidence.
- Diagnostics are explicit commands and report real findings instead of silently rewriting project truth.
- `--doctor --fix` performs only safe generated routing refresh before diagnostics.

## Diagnostics And Search

Code-proven behavior:

| Mode | Behavior | Evidence |
| --- | --- | --- |
| `--lint` | Validates required files, metadata headers, hook budgets, hook configs, executable git hooks, legacy wiki-op file placement, glossary routing, and selected wiki-ops phrases. | `src/modes.ts` |
| `--link-check` | Reports broken wiki links as errors and duplicate index routes or orphan wiki pages as actionable warnings. | `src/modes.ts`, `src/wiki-files.ts` |
| `--quality-check` | Reports document improvement signals such as missing TL;DRs, stale active pages, unresolved markers, read-budget drift, missing evidence on code-proven canonical claims, missing source URLs, duplicate titles, and migration copy risks against `wiki_legacy*`. | `src/modes.ts` |
| `--doctor` | Runs link-check, quality-check, and lint together. | `src/init-project-wiki.ts`, `src/modes.ts` |
| `--query <terms>` | Searches wiki path, title, metadata, and body text with simple weighted scoring. | `src/modes.ts` |

## Routing And Inbox

Code-proven behavior:

| Mode | Behavior | Evidence |
| --- | --- | --- |
| `--doctor --fix` | Refreshes the generated auto-discovered index routing block before diagnostics. | `src/modes.ts` |
| `--refresh-index` | Adds auto-discovered routes for markdown files not already routed; large route sets are split into generated scoped routers under `wiki/indexes/auto-*.md` to keep `wiki/index.md` compact. | `src/modes.ts` |
| `--capture-inbox` | Creates/appends `wiki/inbox/project-candidates.md` with title, category, content, and initial review status; reruns without title/content report `exists` when the inbox already exists. | `src/modes.ts` |
| `--prune-check` | Reports active lifecycle pages that contain unresolved lifecycle wording, stale review triggers, or an older updated date. | `src/modes.ts` |
| `--glossary-init` | Creates `wiki/canonical/glossary.md` and adds glossary routing to `wiki/index.md`. | `src/init-project-wiki.ts`, `src/templates.ts` |

## Skill Installation

Code-proven behavior:

- `install-skill` copies the package into Codex, Claude, Cursor, and/or Gemini skill directories at user or project scope; evidence: `src/install-skill.ts`.
- `install-skill` reports that it only installs reusable skill files and does not create or update `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `wiki/`, `.cursor/rules/`, `.cursor/hooks.json`, `.gemini/settings.json`, `.codex/hooks.json`, or `.claude/settings.json`; evidence: `src/install-skill.ts` and `tests/smoke.sh`.
- `--agents all` targets all supported agents, comma-separated values can target explicit subsets, and `--agents both` remains a Codex/Claude compatibility alias; evidence: `installAgents` in `src/install-skill.ts`.
