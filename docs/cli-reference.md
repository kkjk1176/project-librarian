# CLI Reference

Use the resolved local runner for automation or direct CLI execution:

```bash
node .codex/skills/project-librarian/dist/init-project-wiki.js [init|update] [options]
node .codex/skills/project-librarian/dist/init-project-wiki.js install [--scope user|project] [--agents codex|claude|cursor|gemini|all]
```

`install-skill` remains a compatibility alias for `install`.

`update` is the explicit existing-project update command. It rejects `--migrate` and `--adopt-existing`; use top-level `--migrate` when legacy docs or wiki content should be preserved into `wiki_legacy*` and reviewed. When project-scoped Project Librarian skill installs already exist for the selected agent surfaces, `update` copies the current package's reusable skill files and required local-runner runtime dependencies into those project skill directories before refreshing the managed setup.

### Important Options

| Option | Purpose |
| --- | --- |
| `install --scope user|project --agents <list> --dry-run` | Install reusable skill files and required local-runner runtime dependencies globally or into the current repository; `--dry-run` previews copied files for install only. |
| `update --agents <list>` | Refresh an existing setup and existing project-scoped skill copies; selected surfaces can be `codex`, `claude`, `cursor`, `gemini`, or `all`. |
| `--migrate`, `--adopt-existing` | Preserve an existing wiki as `wiki_legacy*`, create migration inboxes, and generate unit-map/split-plan/coverage review files. |
| `--lint` | Validate generated setup without editing files. |
| `--link-check` | Report broken wiki links, duplicate routes, orphan pages, and pages the startup router cannot reach within the depth budget. |
| `--quality-check` | Report stale, conflicting, and low-quality wiki document signals. |
| `--doctor` | Run lint, link-check, and quality-check together. |
| `--doctor --fix` | Safely refresh generated index routing before diagnostics. `--fix` is only a modifier for `--doctor`. |
| `--migration-lint` | Validate migration coverage, unit-map, split-plan, and review scaffolding separately from normal lint. |
| `--migration-quality-check` | Report migration policy/structure signals separately from normal quality-check. |
| `--migration-doctor` | Run migration-lint and migration-quality-check together. |
| `--query <terms>` | Search wiki paths, metadata, titles, and bodies; answer-first output with per-page TL;DR lines under a hard size cap. |
| `--wiki-impact <page-or-term>` | Show wiki backlinks, `decision_ref` citations, outgoing links, and router depth for matching pages. |
| `--wiki-visualize` | Write a self-contained static wiki graph visualizer to `.project-wiki/wiki-graph.html`. |
| `--wiki-visualize-out <path>` | With `--wiki-visualize`, write to a custom repository-relative path under `.project-wiki/`. |
| `--refresh-index` | Update generated auto-discovered wiki routing. |
| `--capture-inbox --title <title> --content <content> --category <category>` | Append a candidate note to the wiki inbox; category defaults to `project-candidate`. |
| `--handoff-save --goal <goal> --state <state> --next <action>` | Save generated local session handoff state under `.project-wiki/session/`. Repeat `--next`, `--decision`, `--blocked`, `--open-question`, `--verification`, `--last-success-command`, and `--last-failure-command` as needed. |
| `--handoff-show`, `--handoff-status`, `--handoff-clear` | Print, inspect, or remove generated session handoff state. Startup hooks mention the handoff when it exists but do not inject the full file by default. |
| `--handoff-promote-inbox` | Append selected generated handoff facts to `wiki/inbox/project-candidates.md` as a pending candidate. It does not write canonical, plan, or decision pages. |
| `--handoff-injection-enable`, `--handoff-injection-disable`, `--handoff-injection-status` | Opt in, opt out, or inspect the capped full handoff injection experiment. Default startup behavior remains pointer-only. |
| `--issue-draft --issue-title <title>` | Print a read-only GitHub issue body draft for problems or side effects. |
| `--issue-create --issue-title <title> --issue-body-file <path>` | Create a GitHub issue through `gh` after explicit user approval; `--issue-body-file` reuses an existing Markdown body. |
| `--glossary-init` | Create and route the optional glossary page. |
| `--prune-check` | Report active pages with stale or unresolved lifecycle signals. |
| `--prune-check --prune-check-strict` | Omit pages selected only because their `updated` date is older than today. |
| `--review-migration`, `--semantic-migrate` | Sync migration coverage and inbox statuses into migration review files. |
| `--no-git-config` | Install hook files without changing `git core.hooksPath`. |
| `--code-index` | Build the disposable code evidence index. |
| `--code-scope <path>` | With `--code-index`, restrict indexing to one or more project-relative files or directories. |
| `--code-index-out <path>` | Use a custom SQLite output path under `.project-wiki/`; applies to index and read modes. |
| `--acknowledge-small-repo` | With `--code-index`, proceed below the ~5k-file scale gate after the cost warning. |
| `--incremental`, `--code-index-incremental`, `--code-index-full` | With `--code-index`, require an incremental update or force a full rebuild. |
| `--code-index-migrate` | With `--code-index`, explicitly approve replacing an existing index whose schema version differs from the current package. |
| `--code-parser <mode>` | With `--code-index`, select `default` or optional `tree-sitter` extraction. |
| `--code-index-health` | Inspect code evidence cache compatibility and print rebuild guidance without writing. |
| `--code-index-engine <engine>` | Override the default `auto` index engine with `typescript` or `native-rust`. |
| `--code-status`, `--code-files` | Inspect cache freshness or list indexed files. |
| `--code-report` | Print architecture and ownership summaries from the evidence index. |
| `--code-report-section <section>` | Print one section: `coverage`, `ownership`, `languages`, `parsers`, `workspaces`, `workspace-graph`, `routes`, `hotspots`, `configs`, or `edges`. |
| `--code-impact <term>` | Show file, symbol, route, import, edge, and owner impact evidence. |
| `--code-context-pack <term>` | Print a budgeted first-pass context pack with structural file, symbol, route, import, edge, and ownership evidence. |
| `--code-search-symbol <term>` | Search indexed symbols. |
| `--code-query <sql>` | Run conservative read-only SQL over the evidence index. |
