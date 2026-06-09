---
status: active
updated: 2026-06-09
scope: project-decisions
read_budget: on-demand
decision_ref: wiki/meta/decision-policy.md
review_trigger: trivial project decisions need timestamp tracking
---

# Decision Log

## TL;DR

- This page records lightweight timestamped project decisions when timing matters.
- See the entries below for timestamped project decisions.

- 2026-06-08 | distribution | npm registry publication is the official path for `npx project-wiki-bootstrap`, with preview SemVer and release gates defined | canonical: [[canonical/distribution-and-verification]]
- 2026-06-08 | distribution | `project-wiki-bootstrap@0.1.0` published to npm with `latest` dist-tag | canonical: [[canonical/distribution-and-verification]]
- 2026-06-09 | roadmap | large-project roadmap items adopted: incremental code evidence indexing, optional multi-language parser backend, architecture/ownership reports, and monorepo-aware routing | decision: [[decisions/large-project-roadmap-and-metrics]]
- 2026-06-09 | metrics | objective metrics are maintainer release evidence for public claims, not a public user-facing metrics CLI mode | canonical: [[canonical/benchmark-and-release-evidence]]
- 2026-06-09 | product-scope | project framing clarified: Project Wiki Bootstrap is not only for small projects; large projects and monorepos are first-class targets while compact startup context remains the design constraint | canonical: [[canonical/project-brief]]
- 2026-06-09 | issue-reporting | `--issue-draft` is retained as a necessary fast problem-report path for issues discovered by other agents or users, not treated as removable process overhead | canonical: [[canonical/cli-behavior]]
- 2026-06-09 | issue-reporting | actual issue creation is a separate opt-in GitHub CLI integration after user approval, while `--issue-draft` remains read-only and network-free | canonical: [[canonical/cli-behavior]]
- 2026-06-09 | code-evidence | optional Tree-sitter parser mode is explicit through `--code-index --code-parser tree-sitter` and remains separate from default parser mode compatibility | canonical: [[canonical/code-evidence-index]]
- 2026-06-09 | migration-quality | migration review must rewrite legacy meaning instead of copying old markdown files into new project truth, and `--quality-check`/`--doctor` should flag copied legacy content from `wiki_legacy*` | canonical: [[canonical/cli-behavior]]
- 2026-06-09 | runtime-policy | package minimum Node version is raised to `>=22.13` for the whole CLI because code evidence uses stable `node:sqlite` and split runtime support would make installed skill behavior harder to reason about | canonical: [[canonical/distribution-and-verification]]
