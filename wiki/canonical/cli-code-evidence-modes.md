---
status: active
updated: 2026-06-09
scope: project-canonical
read_budget: medium
decision_ref: wiki/decisions/large-project-roadmap-and-metrics.md
review_trigger: code evidence CLI flags, report sections, parser modes, impact search, or indexing update modes change
---

# CLI Code Evidence Modes

## TL;DR

- This page owns the CLI-facing code evidence mode surface.
- Detailed code evidence storage, extraction, query, update, and reporting contracts live under the code evidence canonical pages.
- Code evidence output is support for wiki updates, not canonical truth by itself.

## Mode Surface

Code-proven behavior:

Evidence: `src/args.ts`, `src/init-project-wiki.ts`, `src/code-index.ts`.

| Mode | Behavior | Evidence |
| --- | --- | --- |
| `--code-index --incremental` | Requires an existing compatible code evidence index and updates only changed or added files while removing deleted file rows. If the database is missing, schema metadata is incompatible, or indexed scopes differ from requested scopes, it fails without rebuilding. | `src/args.ts`, `src/init-project-wiki.ts`, `src/code-index.ts` |
| `--code-index --code-index-full` | Forces a full code evidence index rebuild even when a compatible incremental update is possible. | `src/args.ts`, `src/init-project-wiki.ts`, `src/code-index.ts` |
| `--code-index --code-parser tree-sitter` | Builds the code evidence index with explicit optional Tree-sitter parser mode. Unsupported parser values fail, using `--code-parser` without `--code-index` fails, and explicit incremental updates reject databases created with a different parser mode. | `src/args.ts`, `src/init-project-wiki.ts`, `src/code-index.ts` |
| `--code-report` | Prints read-only JSON architecture, ownership, language/profile, parser backend, workspace/CODEOWNERS, route, dependency, config, edge, and evidence coverage summaries from an existing code evidence index. | `src/args.ts`, `src/init-project-wiki.ts`, `src/code-index.ts` |
| `--code-report --code-report-section <section>` | Prints one bounded code report section. Supported section names are coverage, ownership, languages, parsers, workspaces, routes, hotspots, configs, and edges, with aliases for full JSON field names. | `src/args.ts`, `src/init-project-wiki.ts`, `src/code-index.ts` |
| `--code-impact <term>` | Prints read-only JSON impact evidence for a file, symbol, route, or module term, including matching files, symbols, routes, imports, related edges, and owner hints. | `src/args.ts`, `src/init-project-wiki.ts`, `src/code-index.ts` |

## Related Canonical Pages

- [[canonical/code-evidence-index]]: storage, scope, discovery, schema overview, and claim boundary.
- [[canonical/code-evidence-extraction]]: parser backends, language extraction, workspace/CODEOWNERS adapters.
- [[canonical/code-evidence-query-and-updates]]: SQL safety, staleness, impact, incremental update behavior.
- [[canonical/code-evidence-reports]]: architecture, ownership, workspace graph, route/dependency/config reports.
