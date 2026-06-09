# Benchmark Evidence

`project-metrics.js` is a maintainer release-evidence harness. It is not a public CLI user workflow.

Use the default large scale for release claims:

```sh
npm run benchmark -- --sample-repo benchmarks/samples/web-service --sample-repo benchmarks/samples/python-cli --sample-repo benchmarks/samples/mixed-monorepo --out benchmarks/reports/current-large.json --markdown benchmarks/reports/current-large.md
```

Large runs use one discarded warmup run by default. Override the protocol only when the report states the reason:

```sh
npm run benchmark -- --warmup-runs 2 --out benchmarks/reports/current-large.json
```

Use the release gate with a previous JSON baseline when making improvement or regression claims:

```sh
npm run benchmark:release -- --baseline benchmarks/baselines/<version>-large.json --out benchmarks/reports/current-large.json
```

The repo-local standard sample set is:

- `benchmarks/samples/web-service`: JS/TS/config/package dependency route-bearing service.
- `benchmarks/samples/python-cli`: Python CLI/library-shaped project.
- `benchmarks/samples/mixed-monorepo`: apps/packages/services-shaped mixed JS/TS/Python/Go/config repo.

Add more real local repositories as observational validation evidence with repeated `--sample-repo` arguments:

```sh
npm run benchmark -- --sample-repo /absolute/path/to/repo-a --sample-repo /absolute/path/to/repo-b --out benchmarks/reports/current-large.json
```

The release gate only passes when the baseline is comparable by schema, exact Node/V8/runtime environment, platform, architecture, scale, run count, warmup run count, measurement protocol, and scenario set, and when timing claim metrics are stable. The code-heavy scenario measures both code-index throughput and `--code-report` architecture/ownership report generation, including section count, populated evidence table count, route coverage, dependency hotspot coverage, JS/TS/TSX/Go/Python/config coverage, ignored-directory noise, and exact code-evidence lookup correctness for a generated route and package dependency. Each `--sample-repo` copy records separate repo-profiled `sample_repo_*` metrics plus aggregate sample summary values; those metrics are evidence for those repository paths only. Reports include environment and source-control fingerprints, including Node/V8, OS release, CPU model/count, memory, git commit, branch, and dirty status. `benchmark:release` includes the standard sample set, `--fail-on-regression`, `--require-clean`, and `--markdown`; it still requires an explicit `--baseline`. Quick runs validate report shape only.

Sample repo regression gates use both aggregate sample medians and per-repository worst deltas. A large regression in one explicit sample repository fails the release gate even when another sample keeps the aggregate median flat.

Context-efficiency estimates use `ceil(characters / 4)` for every measured markdown read. The default savings metric compares `wiki/startup.md` plus `wiki/index.md` plus the query-returned target document against reading every markdown file under `wiki/` except `wiki/AGENTS.md`. It does not count real tokenizer output from a model API and must not be described as measured LLM token consumption. The JSON also records retrieval strategy correctness: full wiki scan, startup/index only, and targeted query result. Startup/index-only is retained only as an upper-bound field and is expected to be marked as missing the target evidence.

Timing fields are CLI subprocess end-to-end measurements. Reports also include `node_subprocess_overhead_ms` and `*_operation_estimated_ms` fields so readers can separate rough process startup overhead from the operation under test. These estimates are diagnostic evidence, not a replacement for end-to-end release gates.

When `--save-baseline` writes into `benchmarks/baselines/`, the harness also updates `benchmarks/baselines/manifest.json` with schema, package version, source-control, environment, sample fingerprints, and summary metadata. Ad hoc baselines outside that directory do not update the manifest.

Saving a baseline requires a clean git checkout by default. Use `--allow-dirty-baseline` only for non-release smoke validation.

CI runs `npm run benchmark:ci-smoke`, which builds the CLI and runs a quick benchmark with 1 warmup run, 2 measured runs, and the standard sample set. It is a gate for benchmark integrity, not a substitute for large release evidence or a regression gate.

Generate a trend report from two or more benchmark JSON files:

```sh
npm run benchmark:trend -- --trend benchmarks/baselines/0.1.2-large.json --trend benchmarks/reports/current-large.json --trend-out benchmarks/reports/trend.json
```

Trend status uses a 5% threshold and direction-aware labels (`improved`, `flat`, `degraded`) for the tracked summary metrics. The first `--trend` input is the compatibility and delta baseline. Trend input order is preserved. Trend compatibility is intentionally relaxed to Node major version plus platform/architecture so historical series can survive patch-level runtime drift; release-gate comparisons remain strict. Incompatible reports remain listed but are excluded from metric deltas. A metric needs at least two compatible numeric points before the trend status is claimable; otherwise it is reported as `n/a`.

Commit policy:

- Commit release baselines that public release claims compare against.
- Generate release baselines from a clean checkout; dirty baselines are validation artifacts only.
- Commit Markdown summaries only when they are part of release evidence; `benchmarks/reports/*.json` and `benchmarks/reports/*.md` are ignored by default for ad hoc reports.
- Do not commit ad hoc current reports from local investigation.
- Keep temporary comparison outputs outside the repository or under an ignored scratch path.
