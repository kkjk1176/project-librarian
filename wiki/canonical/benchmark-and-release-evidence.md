---
status: active
updated: 2026-06-10
scope: project-canonical
read_budget: on-demand
decision_ref: wiki/decisions/large-project-roadmap-and-metrics.md
review_trigger: benchmark harness, release evidence, roadmap metric, or public claim changes
---

# Benchmark And Release Evidence

## TL;DR

- 성능/효과 측정은 end-user CLI workflow가 아니라 maintainer release evidence workflow다.
- 현재 maintainer benchmark의 목적은 프로젝트를 개발/업데이트하면서 사용자에게 “targeted retrieval 방식이 naive full-wiki scan 대비 어느 정도의 Markdown context 추정 입력량을 피하는지”, “얼마나 빠르게 필요한 정보를 읽는지”, “이전 버전보다 얼마나 좋아졌는지”를 객관적 수치로 설명하는 것이다. 이는 실제 LLM 토큰 사용량 측정이 아니다.
- 실제 LLM 기준 벤치마크가 필요할 때는 OpenAI API/Codex JSONL 계측처럼 실제 `input_tokens`, `cached_input_tokens`, `output_tokens`, `reasoning_output_tokens`, wall-clock latency, tokens/sec, request count, model, service tier, cost 계산 근거를 수집하는 별도 benchmark surface로 다뤄야 한다.
- Codex 실제값 benchmark는 소/중/대 규모 wiki 및 codebase에서 Project Librarian을 적용한 조건과 적용하지 않은 control 조건을 비교해야 한다. 실제 coding agent에게 요청할 법한 과업을 재현하고 token usage, elapsed time, first-token/turn timing, tool-call count, command count, retrieved evidence count, correctness를 함께 측정해야 한다.
- 측정 harness는 docs-heavy wiki, monorepo wiki, scoped-router wiki, code-heavy mixed JS/TS/TSX/Go/Python/Rust/Java/PHP/Kotlin/Swift/C/C++/C#/config index 시나리오와 optional Tree-sitter index 시나리오로 구성된 large-project benchmark suite를 만든다.
- 명시적 `--sample-repo <path>`를 반복해서 주면 synthetic suite에 실제 로컬 repository 복사본 검증 시나리오들을 추가한다. 이 값들은 해당 repo들에 대한 관찰 근거이며 기본 synthetic release claim과 구분한다.
- 개선 릴리스는 benchmark baseline과 current report의 delta를 함께 제시해야 한다.
- Public README는 benchmark 명령 사용법을 사용자가 따라 할 workflow처럼 전면에 두지 말고, 최신 maintainer report의 결과값, 측정 조건, dirty/clean source-control boundary, claimable/unstable status를 먼저 보여줘야 한다. “estimated token avoidance” 표현은 실제 LLM token 사용량이 아니라 Markdown character 기반 context-size estimate임을 가까운 문맥에서 명시해야 한다.

## Current Benchmark Surface

Code-backed current behavior:

- Maintainer benchmark command is `npm run benchmark`, backed by `benchmarks/project-metrics.js`. Evidence: `package.json`, `benchmarks/project-metrics.js`.
- Shared benchmark validation primitives live under `benchmarks/lib/validation.js` so scenario checks are not only embedded in the main metrics runner. Evidence: `benchmarks/lib/validation.js`, `benchmarks/project-metrics.js`.
- Release baseline command is `npm run benchmark:baseline`, which writes a versioned JSON baseline and Markdown summary under `benchmarks/`. Evidence: `package.json`, `benchmarks/project-metrics.js`.
- Release gate command is `npm run benchmark:release -- --baseline <baseline.json> --out <report.json>`, which requires a clean checkout, writes Markdown, and fails unless the comparison is release-claimable. Evidence: `package.json`, `benchmarks/project-metrics.js`.
- CI benchmark smoke command is `npm run benchmark:ci-smoke`, which builds the CLI and runs a quick benchmark with the standard sample set, 1 discarded warmup run, and 2 measured runs. Evidence: `package.json`, `.github/workflows/benchmark.yml`.
- Trend report command is `npm run benchmark:trend -- --trend <report-a.json> --trend <report-b.json> ...`, which writes direction-aware JSON/Markdown trend summaries. Evidence: `package.json`, `benchmarks/project-metrics.js`.
- The benchmark is not exposed as a public `project-librarian` CLI flag. Evidence: `src/args.ts`, `src/init-project-wiki.ts`.
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
- Actual LLM benchmark claims must not reuse the `ceil(characters / 4)` estimate as measured usage. They need an API-backed or Codex JSONL-backed run that records provider-returned token usage plus client-measured timing.
- Default context-efficiency savings compare full-wiki markdown scanning against startup/index plus the query-returned target document. Startup/index-only savings are retained only as an upper-bound field.
- Read timing is local wall-clock filesystem timing; compare only against baselines captured with matching schema, Node version, platform, architecture, scale, run count, warmup run count, measurement protocol, and scenario set.
- Large scale uses one discarded warmup run plus repeated measured runs by default; reported scenario timing metrics are medians and include dispersion statistics.
- Quick scale is a smoke/CI path for report shape, validation coverage, and gate wiring, not release evidence or a performance regression gate.
- Scenario correctness validations must be recorded per measured run. Claimable median metrics use correctness-passed runs only; `median_all_runs` remains available for audit when any run fails or needs review.
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

## Actual LLM Subscription Benchmark Surface

Adopted direction:

- Add a separate opt-in benchmark surface for ChatGPT/Codex-authenticated real LLM measurements instead of mixing these results into the existing deterministic maintainer benchmark.
- Use only Codex CLI for the subscription-authenticated benchmark path. Do not use OpenCode, OpenClaw, or other third-party coding-agent adapters for official project benchmark evidence.
- Primary local path is `codex exec --json` with saved ChatGPT/Codex authentication, because it emits machine-readable turn events with provider-returned usage fields while avoiding direct OpenAI Platform API billing.
- Initial implementation includes dry-run fixture manifests, Codex JSONL parsing, expectation-based correctness checks, sample measured-report validation, and gated measured execution through `benchmarks/codex-llm-metrics.js`. Measured Codex execution requires `--allow-codex-run` and defaults to one with/without pair to preserve comparison validity while limiting subscription quota use.
- Required actual LLM fields: `input_tokens`, `cached_input_tokens`, `output_tokens`, `reasoning_output_tokens` when available, `total_tokens` or derived total, wall-clock duration, first-token latency when stream events expose it, tokens/sec, request/turn count, model, auth mode, and run timestamp.
- Cost fields for subscription-authenticated runs should be labeled as `subscription_usage`, `credit_usage`, or `not_priced`, depending on what Codex exposes. Do not calculate dollar API cost unless the run used an API key or a documented token-to-credit rate card that applies to that auth mode.
- Scenarios should be small and reproducible: fixed prompts against generated wiki fixtures, no repository writes, no external web/tool dependencies, and low run counts by default. Release evidence can increase repetitions only when the user explicitly accepts subscription quota consumption.
- Claims must distinguish three categories: deterministic Markdown context estimate, subscription-authenticated real token/latency measurement, and API-key-priced token/cost measurement.
- Official actual-LLM comparison must be a with/without Project Librarian experiment across small, medium, and large wiki/codebase fixtures. The control condition should omit generated `wiki/startup.md`, `wiki/index.md`, hooks, and code-evidence routing while preserving equivalent repository content needed to answer the task. The treatment condition should use the Project Librarian startup/index routing and optional code-evidence surfaces.
- Scenario prompts should reproduce real agent work, not synthetic token counting alone. Required task families: project onboarding summary, find the current decision/source of truth, answer a code-impact question, locate release/verification policy, and diagnose where a change should be made. Write-changing tasks require a disposable fixture and must report changed-file count; read-only tasks should assert zero file changes.
- Required comparison dimensions: `scale` (`small`, `medium`, `large`), `condition` (`with_project_librarian`, `without_project_librarian`), `task_family`, `prompt_id`, `model`, `auth_mode`, token usage, wall-clock duration, first-token timing when available, Codex turn count, total JSONL item count, command/tool call counts by event type, files read or referenced when observable, final answer correctness, and evidence-citation correctness.
- Tool-call metrics should be derived from Codex JSONL events, including command executions, MCP/tool events, file-change events, plan events, and errors when present. Event counts and normalized invocation counts must be reported separately so start/completed JSONL pairs do not inflate tool-call claims. If a Codex event type does not expose enough detail to count a tool category, the report must mark that field as unavailable instead of estimating silently.
- Public claims from actual-LLM benchmarks should report medians and dispersion by scale and condition, plus with-vs-without deltas. They must not substitute deterministic Markdown token estimates for measured Codex usage.

Concrete implementation plan:

- Add a new runner instead of extending `benchmarks/project-metrics.js`: `benchmarks/codex-llm-metrics.js` for CLI/report writing, `benchmarks/lib/codex-jsonl.js` for JSONL parsing, `benchmarks/lib/llm-fixtures.js` for paired fixture materialization, `benchmarks/lib/llm-correctness.js` for expectation-based answer checks, and `tests/validators/codex-llm-benchmark-smoke.js` for report validation.
- Add npm scripts: `benchmark:llm` for the opt-in LLM benchmark surface, `benchmark:llm:dry-run` for fixture/manifest generation without launching Codex, and `benchmark:llm:parse-smoke` for parser/report-shape validation over checked-in sample JSONL fixtures.
- Matrix: every official report should cover `small`, `medium`, and `large` scales; `with_project_librarian` and `without_project_librarian` conditions; and task families `onboarding`, `decision_lookup`, `code_impact`, `release_policy`, and `change_location`.
- Fixture sizing: small means about 8-20 planning pages and 50-150 source/config files; medium means about 80-160 planning pages and 500-1,000 source/config files; large means 500+ planning pages and 1,500+ source/config files with monorepo-shaped apps/packages/services.
- Treatment condition: bootstrap the fixture with Project Librarian and keep generated `AGENTS.md`, `.codex/hooks.json`, `.codex/hooks/wiki-session-start.js`, `wiki/startup.md`, `wiki/index.md`, canonical/decision/source/meta pages, scoped routers, and optional `.project-wiki/code-evidence.sqlite`.
- Control condition: preserve equivalent repository facts and source files, but remove Project Librarian routing/evidence surfaces such as generated startup/index routing, Project Librarian hook config, scoped routers, and `.project-wiki` code evidence. Keep normal project materials such as README, package files, source files, and scattered docs.
- Measured command shape: `codex exec --json --ephemeral --sandbox read-only "<prompt>"` from the fixture root. The runner must require explicit `--allow-codex-run` before launching Codex and should refuse measured subscription mode when `CODEX_API_KEY` or `OPENAI_API_KEY` is present unless `--auth-mode api-key` is explicitly requested.
- Raw artifacts: write JSONL under `benchmarks/reports/llm/raw/` and aggregate JSON/Markdown under `benchmarks/reports/llm/`. Treat ad hoc LLM reports like other local benchmark reports: do not commit unless deliberately preserving release evidence.
- Report schema v1: top-level fields should include `schema_version`, `benchmark_kind: "codex-actual-llm"`, `auth_mode`, auth audit metadata, `generated_at`, `environment`, `codex`, `configuration`, `summary`, and `scenarios`. Each scenario should include `scale`, `condition`, `task_family`, `prompt_id`, `model`, `models`, `runs`, correctness-passed `median`, `median_all_runs`, `passed_run_count`, `correctness`, and `raw_jsonl_paths`. Validators must reparse raw JSONL paths and recompute run metrics plus medians before accepting measured reports.
- Required parsed metrics: `input_tokens`, `cached_input_tokens`, `output_tokens`, `reasoning_output_tokens`, derived `total_tokens`, `wall_ms`, `tokens_per_second`, `codex_turn_count`, `jsonl_event_count`, `command_event_count`, `command_invocation_count`, `tool_event_count`, `tool_invocation_count`, `mcp_event_count`, `mcp_invocation_count`, `file_change_event_count`, `error_event_count`, model metadata, and `unavailable_event_fields`.
- Correctness checks: the current checker keeps task expectations in `benchmarks/lib/llm-correctness.js` and validates required terms, forbidden terms, expected evidence paths, read-only zero file changes, and missing final text. Validators must recalculate correctness from run metrics rather than trusting stored report status. Public improvement percentages should exclude `needs_review` cases unless manually adjudicated and documented.
- Implementation phases: dry-run, parser, sample measured-report validation, correctness checks, and gated single-scenario measured execution are implemented. Remaining phases are paired with/without measured comparison, full scale/task matrix, stronger real-event taxonomy from raw Codex JSONL, optional expectation-file extraction, Markdown summary, and README claim policy.
- Verification: non-Codex checks are `npm run build`, `npm run typecheck`, `npm run unit`, `node benchmarks/codex-llm-metrics.js --dry-run`, `node tests/validators/codex-llm-benchmark-smoke.js <sample-report.json>`, and `npm run benchmark:llm:parse-smoke`; measured verification starts with one small with/without pair and confirms raw JSONL, parsed usage, correctness, and clean read-only fixture state.

## Roadmap Measurement Gates

- Incremental code evidence index: implemented. Report code-index wall time, files/sec, changed-file reindex count, deleted-file count, and full rebuild comparison before claiming improvement.
- Multi-language parser backend: synthetic benchmark fixture now includes JS/TS/TSX/Python/Go/Rust/Java/PHP/Kotlin/Swift/C/C++/C# files and separate Tree-sitter parser-profile metrics. Continue to report extraction coverage by language, parser failures, index time, and symbol/import/edge counts before making broader parser claims.
- Architecture and ownership summaries: implemented inside the code-heavy benchmark. Report `architecture_report_ms`, section count, populated evidence table count, route coverage, and dependency hotspot coverage before claiming report performance.
- Workspace graph summaries: implemented in `--code-report` and `--code-report-section workspace-graph`. Report workspace count, package managers, lockfiles, internal dependency edges, and external dependency hotspots before claiming monorepo dependency-graph support.
- Monorepo-aware routing: report targeted context token size by scope and compare each scope against full wiki plus full repository wiki reads.

## Current Clean Local Large Benchmark

- Latest clean local report: `benchmarks/reports/current-large.json` and `benchmarks/reports/current-large.md`, generated 2026-06-09T08:08:07.238Z.
- Observed with Node v22.19.0/V8 12.4.254.21-node.29 on darwin arm64, Apple M4 Pro, 14 CPUs, 24,576MB memory.
- Source-control fingerprint in the local generated file: commit `18e730882c4f`, branch `main`, `dirty: false`, 0 status entries. This is clean local release evidence for README benchmark values.
- Large assumptions: 500 varied docs-heavy wiki pages, 40 monorepo workspaces across apps/packages/services/libs, 720 scoped-router pages, 1,608 mixed code fixture files, and 3 repo-local standard sample repositories.
- Benchmark schema: v9 with 1 discarded warmup run and 5 repeated measured runs; timing status was `stable`.
- Claimable metrics in that run: 21. Unstable metrics: none.
- Targeted retrieval vs naive full-wiki scan Markdown context-size estimate avoidance: minimum 99.43%, median 99.61%.
- Read-time reduction: minimum 99.26%, median 99.47%.
- Retrieval correctness: 4/4 passed; targeted-context missing evidence files: 0.
- Scoped router: 720 pages, 13 generated routers, 67.684ms refresh-index time, 4,197-char main index.
- Full code index: 1,608 files at 4,781.27 files/sec, 336.312ms median.
- Incremental code index: 2 reindexed files, 186.776ms, 45.52% less wall-clock time than the full code-index run in the same fixture.
- Architecture/ownership report: 251.175ms, 10 sections, 6 populated evidence tables, 24 routes, 48 dependency hotspot entries.
- Tree-sitter code index: 1,608 files, 626.969ms, 14 parser profiles. Tree-sitter architecture report timing was stable at 254.092ms.
- Standard sample repos: 3 repos, 16 indexed files total, median sample code-index time 132.363ms, median sample architecture report time 135.694ms, 4 total routes, 5 dependency hotspot entries.
- Sample profiles: `01-web-service:web-routes+package-dependencies+config-bearing+symbol-bearing+mixed-language`, `02-python-cli:config-bearing+symbol-bearing+mixed-language+library-or-tooling`, and `03-mixed-monorepo:web-routes+package-dependencies+config-bearing+symbol-bearing+monorepo-shaped+mixed-language`.
- Release claims from the current harness require `measurement.timing_status: stable`, an empty `measurement.unstable_metrics`, and `comparison.regression_status: passed` when a baseline is supplied.

## Historical Local Large Benchmark

- The older `benchmarks/reports/0.1.2-large.json` snapshot used pre-schema-v9 evidence and should not be reused for current README or release claims.
- Retain that snapshot only as historical context. Public README benchmark values should use the current local large report or a clean release baseline generated after it.

## README Presentation Policy

- Public README benchmark content should be phrased as observed maintainer evidence, not as a user instruction to run benchmark commands.
- If the latest available report has `source_control.dirty: true`, disclose it as local validation evidence and avoid presenting it as clean release-gate evidence.
- User-facing benchmark summaries should include the main values readers need before methodology details: Markdown context-size estimate avoidance from targeted retrieval vs naive full-wiki scan, read-time reduction, measured wiki page count, code-index files/time/throughput, incremental update time/reduction, architecture report time/evidence, run count, warmup count, timing status, and unstable metric status.
- Benchmark command examples belong in maintainer/development sections or `benchmarks/README.md`, not in the primary product value section.
