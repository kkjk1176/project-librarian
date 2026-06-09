---
status: active
updated: 2026-06-09
scope: project-decisions
read_budget: medium
decision_ref: wiki/meta/decision-policy.md
review_trigger: large-project roadmap, benchmark methodology, or release evidence policy changes
---

# Large Project Roadmap And Metrics Decisions

## TL;DR

- Large-repository roadmap is active; incremental code evidence indexing, architecture/ownership/workspace-graph reports, monorepo-aware routing, Go lightweight extraction, and optional Tree-sitter JS/TS/Python/Go/Rust/Java/PHP/Kotlin/Swift/C/C++/C# parser mode have initial implementations, while deeper semantic extraction and richer graph analysis remain roadmap items.
- Treat objective metrics as a maintainer release-evidence workflow, not as a public user-facing CLI mode.
- Public claims should be backed by benchmark JSON and baseline deltas.
- Benchmark credibility requires default large-project scenarios, not only a small synthetic smoke fixture.

## Decisions

| Date | Decision | Rationale | Status |
| --- | --- | --- | --- |
| 2026-06-09 | Adopt incremental code evidence indexing as a roadmap item. | Whole-index rebuilds are simple but do not scale well for large repositories; existing staleness detection can evolve into changed-file indexing. | implemented-initial |
| 2026-06-09 | Adopt optional multi-language parser backend exploration. | Large projects are not always TypeScript/JavaScript; stronger extraction should support more languages without breaking the default bootstrap path. Initial Tree-sitter mode is explicit through `--code-parser tree-sitter`. | implemented-initial |
| 2026-06-09 | Add Go lightweight extraction as the first multi-language backend step. | Large repositories commonly mix services and tooling across languages; Go support improves evidence coverage without adding parser dependencies. | implemented-initial |
| 2026-06-09 | Adopt architecture and ownership summaries from code evidence. | Large repositories need decision-ready views such as ownership maps, dependency hot spots, route/API inventories, and changed-area impact reports. | implemented-initial |
| 2026-06-09 | Adopt monorepo-aware wiki routing. | One global startup/index pair can become overloaded in multi-app or multi-package repositories; scoped routing should preserve token discipline. | implemented-initial |
| 2026-06-09 | Keep performance/effectiveness metrics as maintainer benchmark evidence. | Metrics are for release notes, comparison, and public claims about project value, not for end users to measure their own project manually. | adopted |
| 2026-06-09 | Use a default large-project benchmark suite. | A small synthetic fixture is useful for smoke testing but not enough for credible public claims; the maintainer benchmark should cover docs-heavy, monorepo, and code-heavy scenarios by default. | adopted |
| 2026-06-09 | Archive benchmark baselines and release summaries. | Release claims need durable JSON evidence plus human-readable summaries, not transient terminal output only. | adopted |
| 2026-06-09 | Keep `--code-index` as the command for both full and incremental updates. | Users already know the command; compatible existing indexes can update incrementally without adding a second lifecycle mode. | adopted |
| 2026-06-09 | Add `--code-report` for architecture and ownership summaries. | Read-only JSON summaries make indexed evidence usable for large-repo planning without forcing agents to hand-write SQL each time. | adopted |
| 2026-06-09 | Split large auto-discovered wiki route sets into scoped generated routers. | `wiki/index.md` must stay within startup-hook budget even when a monorepo has many unrouted pages. | adopted |
| 2026-06-09 | Add workspace dependency graph reporting. | Large monorepos need package-manager, lockfile, internal dependency, and external hotspot signals in a bounded report section. | implemented-initial |
| 2026-06-09 | Expand optional Tree-sitter backend coverage. | Optional parser mode should cover common large-repo languages beyond JS/TS/Python/Go while preserving the default dependency-light path. | implemented-initial |

## Measurement Gate

Before claiming a release improves project value, collect and compare benchmark reports:

1. Capture or select a previous benchmark JSON baseline.
2. Run the current default large-scale maintainer benchmark after building `dist/`.
3. Compare token savings, compact read time, full wiki read time, bootstrap time, diagnostics time, query time, scoped-router refresh/index size, full code-index throughput, incremental code-index timing, Tree-sitter timing/profile coverage, and architecture/workspace graph report timing.
4. Save release evidence with `npm run benchmark:baseline` when publishing benchmark claims.
5. Report both current values and deltas.

## Rejected

- Rejected: public `project-wiki-bootstrap --metrics` lifecycle command | It frames metrics as a user workflow, but the intended use is maintainer evidence for product claims and release comparisons.
- Rejected: qualitative-only release claims | The project needs objective values for token savings, lookup speed, and before/after improvement.
- Rejected: small synthetic-only benchmark for public claims | It can validate report shape, but it does not represent large docs-heavy, monorepo, or code-heavy project pressure.
- Rejected: separate public `--code-index-incremental` mode | The existing `--code-index` command can choose full vs incremental based on schema and scope compatibility without making users pick an implementation strategy.
