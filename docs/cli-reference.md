# CLI Reference

## Commands

```text
project-librarian init [options]
project-librarian update [options]
project-librarian install [--scope user|project] [--agents <list>] [--dry-run]
project-librarian install-skill [--scope user|project] [--agents <list>] [--dry-run]
```

- `init` creates missing wiki and selected agent setup files. It preserves an existing `wiki/`.
- `update` refreshes managed setup and already-present agent surfaces while preserving wiki content.
- `install` installs reusable skill files for the selected agents.
- `install-skill` is a compatibility alias for `install`.

## Wiki Diagnostics

| Option | Purpose |
| --- | --- |
| `--lint` | Validate required files, metadata, and agent setup. |
| `--link-check` | Report broken links, duplicate routes, orphan pages, and routing problems. |
| `--quality-check` | Report stale, conflicting, unresolved, or oversized documents. |
| `--doctor` | Run lint, link, quality, and router-truth checks. |
| `--fix` | With `--doctor`, refresh the generated index block first. |
| `--prune-check` | List active pages with stale or unresolved signals. |
| `--prune-check-strict` | Ignore candidates whose only signal is age. |

## Wiki Retrieval and Maintenance

| Option | Purpose |
| --- | --- |
| `--query <terms>` | Search wiki paths, metadata, titles, and bodies. |
| `--wiki-impact <target>` | Show backlinks, outgoing links, decision citations, and router depth. |
| `--wiki-neighborhood <target>` | Suggest a bounded read order around a page or term. |
| `--refresh-index` | Refresh the managed auto-discovered index block. |
| `--glossary-init` | Create and route `wiki/20-shared/glossary.md`. |
| `--capture-inbox` | Append a candidate using `--title`, `--content`, and optional `--category`. |

## Session Handoff

| Option | Purpose |
| --- | --- |
| `--handoff-save` | Save generated resume state under `.project-wiki/session/`. |
| `--handoff-show` | Print the saved handoff. |
| `--handoff-status` | Print handoff state as JSON. |
| `--handoff-clear` | Remove generated handoff files. |
| `--handoff-promote-inbox` | Copy selected facts to the wiki inbox. |
| `--handoff-injection-enable` | Enable capped full handoff injection. |
| `--handoff-injection-disable` | Disable full handoff injection. |
| `--handoff-injection-status` | Print injection state as JSON. |

`--handoff-save` accepts `--goal`, `--state`, repeated `--blocked`, `--next`, `--decision`, `--open-question`, and `--verification`, plus last successful and failed commands.

## Setup and Support

- `--agents codex|claude|cursor|gemini|all` selects setup surfaces.
- `--scope user|project` selects the skill installation scope.
- `--dry-run` previews skill installation.
- `--no-git-config` writes hook files without changing `core.hooksPath`.
- `--issue-draft`, `--issue-create`, `--issue-title`, and `--issue-body-file` support issue reporting.
- `--help` prints the current public surface.

Removed commands and options are treated as unknown input and fail before writing files.
