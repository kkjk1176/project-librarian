---
status: active
updated: 2026-06-09
scope: project-canonical
read_budget: on-demand
decision_ref: wiki/decisions/large-project-roadmap-and-metrics.md
review_trigger: benchmark harness, release evidence, roadmap metric, or public claim changes
---

# Benchmark And Release Evidence

## TL;DR

- 성능/효과 측정은 end-user CLI workflow가 아니라 maintainer release evidence workflow다.
- 목적은 프로젝트를 개발/업데이트하면서 사용자에게 “targeted context가 full wiki scan 대비 어느 정도 추정 토큰 입력을 피하는지”, “얼마나 빠르게 필요한 정보를 읽는지”, “이전 버전보다 얼마나 좋아졌는지”를 객관적 수치로 설명하는 것이다.
- 측정 harness는 docs-heavy wiki, monorepo wiki, scoped-router wiki, code-heavy mixed JS/TS/TSX/Go/Python/Rust/Java/PHP/Kotlin/Swift/C/C++/C#/config index 시나리오와 optional Tree-sitter index 시나리오로 구성된 large-project benchmark suite를 만든다.
- 명시적 `--sample-repo <path>`를 반복해서 주면 synthetic suite에 실제 로컬 repository 복사본 검증 시나리오들을 추가한다. 이 값들은 해당 repo들에 대한 관찰 근거이며 기본 synthetic release claim과 구분한다.
- 개선 릴리스는 benchmark baseline과 current report의 delta를 함께 제시해야 한다.

## Current Benchmark Surface

Code-backed current behavior:

- Maintainer benchmark command is `npm run benchmark`, backed by `benchmarks/project-metrics.js`. Evidence: `package.json`, `benchmarks/project-metrics.js`.
- Shared benchmark validation primitives live under `benchmarks/lib/validation.js` so scenario checks are not only embedded in the main metrics runner. Evidence: `benchmarks/lib/validation.js`, `benchmarks/project-metrics.js`.
- Release baseline command is `npm run benchmark:baseline`, which writes a versioned JSON baseline and Markdown summary under `benchmarks/`. Evidence: `package.json`, `benchmarks/project-metrics.js`.
- Release gate command is `npm run benchmark:release -- --baseline <baseline.json> --out <report.json>`, which requires a clean checkout, writes Markdown, and fails unless the comparison is release-claimable. Evidence: `package.json`, `benchmarks/project-metrics.js`.
- CI benchmark smoke command is `npm run benchmark:ci-smoke`, which builds the CLI and runs a quick benchmark with the standard sample set, 1 discarded warmup run, and 2 measured runs. Evidence: `package.json`, `.github/workflows/benchmark.yml`.
- Trend report command is `npm run benchmark:trend -- --trend <report-a.json> --trend <report-b.json> ...`, which writes direction-aware JSON/Markdown trend summaries. Evidence: `package.json`, `benchmarks/project-metrics.js`.
- The benchmark is not exposed as a public `project-wiki-bootstrap` CLI flag. Evidence: `src/args.ts`, `src/init-project-wiki.ts`.
- The default benchmark scale creates large project fixtures in a temporary directory, runs the built CLI, and emits JSON. Evidence: `benchmarks/project-metrics.js`.
- Benchmark schema v9 records repeated-run measurement metadata, discarded warmup count, measurement protocol, claimable/unstable timing metrics, scenario validation checks, timing dispersion stats, environment fingerprint, source-control fingerprint, sample repo content fingerprints, scenario-set compatibility, baseline regression status, targeted-context estimated-token avoidance, scoped-router generation metrics, retrieval correctness, code-evidence correctness, default and Tree-sitter code-index timing, parser-profile coverage, subprocess-overhead estimates, and baseline manifest metadata. Evidence: `benchmarks/project-metrics.js`.
- The standard sample repo set lives under `benchmarks/samples/`: `web-service` for JS/TS/config/package-dependency route coverage, `python-cli` for library/tooling-shaped Python/config coverage, and `mixed-monorepo` for apps/packages/services-shaped mixed JS/TS/Python/Go/config coverage. Evidence: `benchmarks/samples/`, `tests/smoke.sh`.
- Smoke tests use `--quick` only to validate report shape; CI uses quick scale for benchmark integrity smoke coverage; public release claims should use the default large scale. Evidence: `tests/smoke.sh`, `benchmarks/project-metrics.js`, `.github/workflows/benchmark.yml`.
- The benchmark can write a current report with `--out <path>`, compare against a previous report with `--baseline <path>`, save a baseline with `--save-baseline [path]`, write a Markdown summary with `--markdown [path]`, repeat measurements with `--runs <n>`, discard warmup measurements with `--warmup-runs <n>`, require a clean git checkout with `--require-clean`, add one or more explicit local repository validation scenarios with repeated `--sample-repo <path>`, and fail CI on release-gate problems with `--fail-on-regression`. Evidence: `benchmarks/project-metrics.js`.

## Metrics Contract

Required release-evidence metrics:

| Metric | Meaning | Why It Matters |
| --- | --- | --- |
| `compact_context.estimated_tokens` | Estimated tokens for `wiki/startup.md` plus `wiki/index.md`. | Measures session-start context cost, not full task context. |
| `targeted_context.estimated_tokens` | Estimated tokens for `wiki/startup.md`, `wiki/index.md`, and the query-returned target document. | Models a targeted lookup more honestly than startup/index-only context. |
| `full_wiki.estimated_tokens` | Estimated tokens for all wiki markdown files in the fixture. | Measures the naive full-scan baseline avoided by read-on-demand routing. |
| `savings.estimated_token_avoidance_percent` | Percent estimated-token avoidance from targeted context vs full wiki read, using `ceil(characters / 4)`. | Supports only context-efficiency claims, not measured LLM tokenizer or API token-consumption claims. |
| `startup_index_only_upper_bound` | Upper-bound savings from startup/index-only context vs full wiki read. | Prevents the benchmark from presenting startup/index-only savings as the default task-context estimate. |
| `retrieval_strategy_comparison` | Full wiki scan, startup/index-only, and targeted query-result context size plus expected-evidence status. | Makes the old startup/index-only comparison visible as an upper-bound that misses task evidence. |
| `retrieval_correctness` | Query text, expected file, whether query returned the expected file, and whether targeted context contains it. | Ensures context-efficiency is tied to a successful lookup, not just fewer characters. |
| `targeted_context.avg_read_ms` and `full_wiki.avg_read_ms` | Local filesystem read timing over repeated reads. | Supports targeted retrieval vs full-scan read-time claims. |
| `savings.read_time_reduction_percent` | Read-time reduction from targeted context vs full wiki scan. | Measures practical targeted-lookup speed benefit. |
| `bootstrap_create_ms` | Time to create a fresh wiki. | Guards baseline bootstrap performance. |
| `doctor_ms` | Time to run diagnostics over the synthetic large wiki. | Guards lifecycle diagnostic scalability. |
| `query_ms` | Time to search the synthetic large wiki. | Guards project wiki lookup responsiveness. |
| `scoped_refresh_index_ms`, `scoped_router_count`, `scoped_main_index_chars`, and `scoped_target_router_chars` | Time and size checks for generated scoped routers under `wiki/indexes/auto-*.md`. | Proves monorepo route splitting keeps `wiki/index.md` compact while preserving navigable target evidence. |
| `code_index_ms` and `code_index_files_per_second` | Time and throughput for a full synthetic mixed JS/TS/TSX/Go/Python/polyglot/config code evidence index. | Guards large-repo code evidence scalability across representative local file kinds. |
| `incremental_index_ms`, `incremental_reindexed_files`, and `incremental_deleted_files` | Time and touched-file counts for changed-file code evidence updates. | Supports incremental-index improvement claims. |
| `full_to_incremental_time_reduction_percent` | Percent wall-clock reduction from full code index to incremental rerun in the fixture. | Quantifies large-repo update-loop improvement. |
| `architecture_report_ms`, `architecture_report_sections`, `architecture_report_evidence_tables`, `architecture_report_routes`, and `architecture_report_dependencies` | Time and content coverage for `--code-report` architecture/ownership summaries from the generated code evidence index. | Supports large-project architecture/ownership report claims while blocking empty-report timing claims. |
| `architecture_report_language_profiles` and code-heavy assumptions for generated test, Go, Python, Rust, Java, PHP, Kotlin, Swift, C, C++, C#, lockfile, config, and ignored files | Coverage of mixed source/config/profile realism in the synthetic code fixture. | Prevents the code-heavy benchmark from proving only a clean TypeScript-only path. |
| `tree_sitter_code_index_ms`, `tree_sitter_code_files`, `tree_sitter_parser_profiles`, and `tree_sitter_parser_profile_names` | Time, file coverage, and parser-profile coverage for optional Tree-sitter indexing over the same synthetic code fixture. | Supports parser-backend coverage claims without mixing optional-parser cost into the default code-index metric. |
| code-heavy `evidence_correctness` | Exact SQL lookup correctness for a generated route and dependency row. | Ensures code-index timing corresponds to retrievable evidence that a user task would need. |
| `node_subprocess_overhead_ms` and `*_operation_estimated_ms` | Rough Node CLI process startup overhead and elapsed-minus-overhead diagnostics. | Separates end-to-end CLI timing from approximate operation timing without weakening release gates. |
| `sample_repo_count`, `sample_repo_code_index_ms`, `sample_repo_code_files`, `sample_repo_architecture_report_ms`, `sample_repo_architecture_report_routes`, `sample_repo_architecture_report_dependencies`, and scenario-level `sample_repo_profile` | Optional validation metrics for copied local repositories passed through repeated `--sample-repo`. | Adds actual repository evidence while keeping the claim boundary tied to those explicit paths and repo shapes. |
| scenario confidence labels | Claim boundary for docs-heavy, monorepo, and code-heavy scenarios. | Prevents overclaiming from one fixture type. |
| `measurement.runs`, `measurement.warmup_runs`, `measurement.measurement_protocol`, `measurement.timing_status`, scenario `timing_stats`, `claimable_metrics`, and `unstable_metrics` | Measured-run count, discarded warmup count, timing dispersion, and release-claim eligibility. | Separates stable signal from local timing noise and blocks overclaiming. |
| scenario `validations` | Correctness checks for query, doctor, indexing, and incremental update evidence. | Ensures the benchmark measured successful behavior, not only elapsed time. |
| `comparison.regression_status`, `comparison.compatibility`, and `comparison.regression_thresholds` | Baseline delta assessment against tolerated noise plus comparable-environment checks. | Makes release comparisons actionable and CI-enforceable. |
| `environment`, `source_control`, and `benchmark_configuration` | Runtime, hardware, git commit/branch/dirty state, and protocol fingerprint for the report. | Makes benchmark evidence auditable and prevents anonymous timing artifacts. |
| sample repo SHA-256 fingerprints | Filtered sample repo content identity after ignored-directory policy is applied. | Prevents comparing different sample projects that happen to occupy the same sample slot. |
| baseline manifest | Versioned manifest for official files under `benchmarks/baselines/`, including schema, package version, source control, environment, samples, and summary. | Makes committed release baseline inventory reviewable without opening every JSON report. |
| trend report metrics | Direction-aware first/last deltas for targeted-context estimated-token avoidance, code index, incremental index, architecture report, and sample repo timings. | Finds gradual degradation that single baseline pass/fail may miss. |

## Measurement Rules

- Token estimates use `ceil(characters / 4)` for stable cross-version comparison without a tokenizer dependency; they are not measured LLM tokenizer counts or API token consumption.
- Default context-efficiency savings compare full-wiki markdown scanning against startup/index plus the query-returned target document. Startup/index-only savings are retained only as an upper-bound field.
- Read timing is local wall-clock filesystem timing; compare only against baselines captured with matching schema, Node version, platform, architecture, scale, run count, warmup run count, measurement protocol, and scenario set.
- Large scale uses one discarded warmup run plus repeated measured runs by default; reported scenario timing metrics are medians and include dispersion statistics.
- Quick scale is a smoke/CI path for report shape, validation coverage, and gate wiring, not release evidence or a performance regression gate.
- Scenario correctness validations must pass before a report is emitted.
- Default large fixture sizes should stay stable across releases unless the benchmark schema version changes.
- Baseline regressions should be interpreted through schema v9 thresholds; use `--fail-on-regression` when benchmark comparison is part of a release gate.
- `--fail-on-regression` must fail when `comparison.regression_status` is `failed`, `unstable`, or `not_comparable`; only `passed` is release-claimable.
- `--fail-on-regression` requires `--baseline`; a release gate without a baseline is invalid.
- Release evidence that must prove clean-checkout provenance should use `--require-clean`.
- Saving a baseline requires a clean git checkout unless `--allow-dirty-baseline` is explicitly set for non-release validation.
- Release-gate comparisons run under `--require-clean` treat missing or dirty source-control provenance as not comparable.
- Scenario compatibility includes sample repo id, profile, content fingerprint, and fingerprint algorithm, not only scenario slot names.
- Release comparisons use strict compatibility checks, including exact Node/V8/environment fields when source-control strictness is requested.
- Trend reports preserve input order and use relaxed compatibility checks based on Node major version plus platform/architecture; incompatible inputs are excluded from metric deltas while still listed with compatibility issues. A metric needs at least two compatible numeric points before trend status is claimable.
- Timing claims must cite `measurement.claimable_metrics`; metrics listed in `measurement.unstable_metrics` require rerun or investigation before release claims.
- Claim stability checks use both coefficient of variation and an absolute timing range threshold, and each claim records min/median/max/range for review.
- Any public improvement claim should cite current report values and baseline delta, not only qualitative descriptions.
- Release notes may summarize the JSON, but the raw benchmark report should remain available for review.
- `benchmark:baseline` should be run to archive baseline evidence; `benchmark:release` should be run for gated current-vs-baseline release claims.
- Commit release baselines that public claims compare against; do not commit ad hoc current reports from local investigation.
- Claims should use the scenario-specific confidence boundary from the JSON. Default code-index throughput covers generated JS, TS, TSX, test TS, Go, Python, Rust, Java, PHP, Kotlin, Swift, C, C++, C#, YAML, JSON, package metadata, package-lock, and ignored-directory fixture files; Tree-sitter metrics are reported separately.
- `--sample-repo` metrics are observational evidence for the explicit local repository paths only. Do not use sample repositories as a general large-project claim without also citing the synthetic suite, sample paths, and repo profiles.
- Ad hoc current reports under `benchmarks/reports/*.json` and `benchmarks/reports/*.md` are ignored by default; commit only deliberate release evidence summaries or baselines.
- Official release baselines must be generated from a clean checkout with the standard sample set. If a locally generated baseline reports `source_control.dirty: true`, treat it as implementation evidence until regenerated clean for public release claims.

## Roadmap Measurement Gates

- Incremental code evidence index: implemented. Report code-index wall time, files/sec, changed-file reindex count, deleted-file count, and full rebuild comparison before claiming improvement.
- Multi-language parser backend: synthetic benchmark fixture now includes JS/TS/TSX/Python/Go/Rust/Java/PHP/Kotlin/Swift/C/C++/C# files and separate Tree-sitter parser-profile metrics. Continue to report extraction coverage by language, parser failures, index time, and symbol/import/edge counts before making broader parser claims.
- Architecture and ownership summaries: implemented inside the code-heavy benchmark. Report `architecture_report_ms`, section count, populated evidence table count, route coverage, and dependency hotspot coverage before claiming report performance.
- Workspace graph summaries: implemented in `--code-report` and `--code-report-section workspace-graph`. Report workspace count, package managers, lockfiles, internal dependency edges, and external dependency hotspots before claiming monorepo dependency-graph support.
- Monorepo-aware routing: report targeted context token size by scope and compare each scope against full wiki plus full repository wiki reads.

## Previous Local Large Benchmark

- This is a pre-schema-v9 local evidence snapshot retained only as historical context. Regenerate a clean large benchmark with schema v9 before making current public release claims.
- Observed on 2026-06-09 with Node v22.19.0/V8 12.4.254.21-node.29 on darwin arm64, Apple M4 Pro, 14 CPUs, 24,576MB memory.
- Source-control fingerprint in the local generated file: commit `e2b4554ad07b`, branch `main`, `dirty: true` because the benchmark improvements were still uncommitted when the local evidence was generated.
- Large assumptions: 500 varied docs-heavy wiki pages, 40 monorepo workspaces across apps/packages/services/libs, 1,416 mixed code fixture files, and the 2 repo-local standard sample repositories.
- Benchmark schema: v5 with 1 discarded warmup run and 5 repeated measured runs; timing status was `stable` with no `measurement.unstable_metrics`.
- Claimable metrics in that run: 12/12 claim metrics, covering docs, monorepo, full code index, incremental code index, architecture report, and both standard sample repos.
- Targeted-context estimated-token avoidance: minimum 99.67%, median 99.76%.
- Read-time reduction: minimum 99.45%, median 99.55%.
- Full code index: 1,416 files at 4,700.84 files/sec, 301.223ms median.
- Incremental code index: 2 reindexed files, 1 deleted file, 159.529ms, 47.22% less wall-clock time than the full code-index run in the same fixture.
- Architecture/ownership report: 208.456ms, 7 sections, 6 populated evidence tables, 24 routes, 48 dependency hotspot entries.
- Standard sample repos: 2 repos, 8 indexed files total, median sample code-index time 119.921ms, median sample architecture report time 120.462ms, 2 total routes, 2 dependency hotspot entries.
- Sample profiles: `01-web-service:web-routes+package-dependencies+config-bearing+symbol-bearing+mixed-language` and `02-python-cli:config-bearing+symbol-bearing+mixed-language+library-or-tooling`.
- Trend mode was validated with two quick reports and emitted direction-aware metrics for targeted-context estimated-token avoidance, code index time, throughput, incremental index time, architecture report time, and sample repo timings while excluding incompatible reports from metric deltas and marking single-compatible-point metrics as `n/a`.
- Release claims from the updated harness require `measurement.timing_status: stable`, an empty `measurement.unstable_metrics`, and `comparison.regression_status: passed` when a baseline is supplied.
