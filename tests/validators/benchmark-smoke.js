#!/usr/bin/env node

const fs = require("node:fs");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function assert(condition, message) {
  if (!condition) {
    console.error(message);
    process.exit(1);
  }
}

function scenario(report, kind) {
  return report.scenarios.find((item) => item.fixture_kind === kind);
}

function validateFullReport(file) {
  const m = readJson(file);
  assert(m.schema_version === 9 && m.scale === "quick", "unexpected benchmark schema or scale");
  assert(m.environment && m.environment.node && m.environment.v8 && m.environment.os_release && m.environment.cpu_model && m.environment.cpu_count < 1 === false && m.environment.total_memory_mb < 1 === false, "missing environment fingerprint");
  assert(m.source_control && m.source_control.available === true && m.source_control.commit && m.source_control.short_commit && typeof m.source_control.dirty === "boolean", "missing source-control fingerprint");
  assert(m.benchmark_configuration && m.benchmark_configuration.sample_repo_count === 3 && m.benchmark_configuration.measurement_protocol === "median", "missing benchmark configuration");
  assert(Array.isArray(m.benchmark_configuration.sample_repo_fingerprints) && m.benchmark_configuration.sample_repo_fingerprints.length === 3, "missing sample repo fingerprints");
  assert(m.benchmark_configuration.sample_repo_fingerprints.every((item) => item.algorithm === "sha256" && item.value && item.file_count > 0), "invalid sample repo fingerprint");
  assert(m.measurement.runs === 1 && m.measurement.warmup_runs === 0 && m.measurement.measurement_protocol === "median" && m.measurement.timing_status === "single-run", "unexpected measurement protocol");
  assert(Array.isArray(m.measurement.claims) && m.measurement.claims.some((claim) => claim.id === "code.architecture_report_ms"), "missing code architecture claim");
  assert(m.measurement.claims.some((claim) => claim.id === "docs.targeted_context.avg_read_ms"), "missing docs targeted context claim");
  assert(m.measurement.claims.some((claim) => claim.id === "scoped.refresh_index_ms"), "missing scoped refresh claim");
  assert(m.measurement.claims.filter((claim) => claim.id.startsWith("sample_repo.")).length === 6, "missing sample repo claims");
  assert(Array.isArray(m.measurement.claimable_metrics) && Array.isArray(m.measurement.unstable_metrics), "missing claimable metric arrays");
  assert(m.scenarios.length === 7, "unexpected scenario count");
  assert(m.scenarios.every((s) => Array.isArray(s.validations) && s.validations.every((v) => v.status === "passed")), "scenario validation failed");
  assert(m.scenarios.every((s) => s.measurement && s.measurement.runs === 1), "missing scenario measurement metadata");
  assert(m.large_project_assumptions.monorepo_workspaces >= 5 && m.large_project_assumptions.scoped_route_pages >= 50 && m.large_project_assumptions.scoped_route_areas >= 1, "large-project assumptions too small");
  assert(m.large_project_assumptions.sample_repo_paths.length === 3, "unexpected sample repo path count");
  for (const kind of ["tsx", "go", "python", "rust", "java", "php", "kotlin", "swift", "c", "cpp", "csharp", "package-lock"]) assert(m.large_project_assumptions.code_heavy_mixed_file_kinds.includes(kind), `missing mixed file kind ${kind}`);
  assert(m.summary.min_estimated_token_avoidance_percent > 0, "missing token avoidance");
  assert(m.summary.retrieval_correctness_checks >= 2 && m.summary.retrieval_correctness_passed === m.summary.retrieval_correctness_checks, "retrieval correctness failed");
  assert(m.summary.targeted_context_evidence_missing === 0 && m.summary.startup_index_only_evidence_missing > 0, "unexpected evidence missing counts");
  assert(m.summary.code_evidence_correctness_passed === 1, "code evidence correctness failed");

  const docs = scenario(m, "docs-heavy-large-project");
  assert(docs && docs.savings.basis === "targeted_context_vs_full_wiki_scan", "missing docs scenario");
  assert(docs.targeted_context && docs.targeted_context.file_count === 3, "unexpected docs targeted context");
  assert(docs.targeted_context.estimated_tokens > docs.compact_context.estimated_tokens, "docs targeted context should exceed compact context");
  assert(docs.startup_index_only_upper_bound.estimated_token_avoidance_percent > docs.savings.estimated_token_avoidance_percent, "startup-only upper bound should exceed targeted savings");
  assert(docs.retrieval_correctness && docs.retrieval_correctness.correctness_status === "passed" && docs.retrieval_correctness.query_returned_expected_file === true, "docs retrieval correctness failed");
  assert(Array.isArray(docs.retrieval_strategy_comparison), "missing retrieval strategy comparison");
  const docsStartup = docs.retrieval_strategy_comparison.find((item) => item.strategy === "startup_index_only");
  const docsTargeted = docs.retrieval_strategy_comparison.find((item) => item.strategy === "targeted_query_result");
  assert(docsStartup && docsStartup.correctness_status === "evidence-missing-without-followup" && docsStartup.expected_evidence_files_missing >= 1, "startup-only comparison should miss evidence");
  assert(docsTargeted && docsTargeted.correctness_status === "evidence-present" && docsTargeted.expected_evidence_files_missing === 0, "targeted comparison should include evidence");

  assert(m.summary.scoped_refresh_index_ms > 0 && m.summary.scoped_router_count >= 1 && m.summary.scoped_main_index_chars > 0 && m.summary.scoped_target_router_chars > 0, "missing scoped summary");
  assert(m.summary.code_index_ms > 0 && m.summary.code_index_files > 0 && m.summary.code_index_files_per_second > 0, "missing code index summary");
  assert(typeof m.summary.code_index_incremental_reindexed_files === "number" && m.summary.code_index_incremental_ms > 0, "missing incremental code index summary");
  assert(m.summary.architecture_report_ms > 0 && m.summary.architecture_report_sections >= 7 && m.summary.architecture_report_evidence_tables >= 6, "missing architecture report summary");
  assert(m.summary.architecture_report_routes > 0 && m.summary.architecture_report_dependencies > 0, "missing architecture report evidence");
  assert(m.summary.tree_sitter_code_index_ms > 0 && m.summary.tree_sitter_code_files === m.summary.code_index_files && m.summary.tree_sitter_parser_profiles >= 13, "missing tree-sitter benchmark summary");
  assert(m.summary.sample_repo_count === 3 && m.summary.sample_repo_code_files > 1 && m.summary.sample_repo_code_index_ms > 0, "missing sample repo summary");
  assert(m.summary.sample_repo_architecture_report_ms > 0 && m.summary.sample_repo_architecture_report_routes > 0 && m.summary.sample_repo_architecture_report_dependencies > 0, "missing sample repo architecture summary");
  assert(Array.isArray(m.summary.sample_repo_profiles) && m.summary.sample_repo_profiles.length === 3, "missing sample repo profiles");

  const scoped = scenario(m, "scoped-routing-large-project");
  assert(scoped && scoped.scoped_router_count >= 1 && scoped.main_index_chars <= 4500 && scoped.refresh_index_ms > 0 && scoped.link_check_ms > 0, "scoped scenario failed");
  assert(scoped.targeted_context.file_count === 4 && scoped.retrieval_correctness.correctness_status === "passed", "scoped retrieval failed");
  assert(scoped.scoped_router_files.some((route) => route === "wiki/indexes/auto-apps-app-0.md"), "missing expected scoped router");

  const code = scenario(m, "code-heavy-large-project");
  assert(code && code.incremental_index_mode === "incremental", "missing code-heavy scenario");
  assert(code.assumptions.generated_js_files && code.assumptions.generated_tsx_files && code.assumptions.generated_config_files && code.assumptions.generated_go_files && code.assumptions.generated_python_files && code.assumptions.generated_rust_files && code.assumptions.generated_java_files && code.assumptions.generated_php_files && code.assumptions.generated_kotlin_files && code.assumptions.generated_swift_files && code.assumptions.generated_c_files && code.assumptions.generated_cpp_files && code.assumptions.generated_csharp_files && code.assumptions.generated_ignored_files, "missing code-heavy assumptions");
  assert(code.architecture_report_schema_version === 1 && code.architecture_report_stale_files === 0 && code.architecture_report_language_profiles >= 3, "invalid code-heavy architecture report");
  assert(code.tree_sitter_code_index_ms > 0 && code.tree_sitter_parser_profiles >= 13 && code.tree_sitter_parser_profile_names.includes("tree-sitter-rust") && code.tree_sitter_parser_profile_names.includes("tree-sitter-csharp"), "invalid tree-sitter architecture report");
  assert(code.node_subprocess_overhead_ms > 0 && code.code_index_operation_estimated_ms >= 0 && code.architecture_report_operation_estimated_ms >= 0, "invalid code-heavy timing");
  assert(code.evidence_correctness && code.evidence_correctness.correctness_status === "passed" && code.evidence_correctness.route_query_returned_expected_file === true && code.evidence_correctness.dependency_query_returned_expected_file === true, "code-heavy evidence correctness failed");

  const samples = m.scenarios.filter((s) => s.fixture_kind.startsWith("sample-repo-validation-"));
  assert(samples.length === 3, "unexpected sample scenario count");
  assert(samples.every((s) => s.confidence === "observational-for-the-explicit-local-repo-only" && s.sample_repo_id && s.sample_repo_profile && s.sample_repo_fingerprint && s.sample_repo_fingerprint_algorithm === "sha256"), "invalid sample scenario identity");
  assert(samples.every((s) => Array.isArray(s.sample_repo_profile_traits) && s.sample_repo_architecture_report_stale_files === 0 && s.node_subprocess_overhead_ms > 0), "invalid sample scenario metadata");
  assert(samples.every((s) => s.sample_repo_code_index_operation_estimated_ms >= 0 && s.sample_repo_architecture_report_operation_estimated_ms >= 0), "invalid sample operation estimates");
  assert(samples.some((s) => s.sample_repo_profile_traits.includes("web-routes")), "missing web-routes sample");
  assert(samples.some((s) => s.sample_repo_profile_traits.includes("library-or-tooling")), "missing library/tooling sample");
  assert(samples.some((s) => s.sample_repo_profile_traits.includes("monorepo-shaped")), "missing monorepo-shaped sample");
  assert(m.notes.some((note) => note.includes("release evidence")) && m.notes.some((note) => note.includes("repeated --sample-repo")), "missing release evidence notes");
  assert(m.notes.some((note) => note.includes("benchmarks/samples")) && m.notes.some((note) => note.includes("allow-dirty-baseline")) && m.notes.some((note) => note.includes("not a model-tokenizer measurement")), "missing benchmark boundary notes");
}

function validateComparison(file) {
  const m = readJson(file);
  assert(m.comparison, "missing comparison");
  assert(m.comparison.baseline_package_version === m.package_version, "baseline package mismatch");
  assert(typeof m.comparison.summary_min_estimated_token_avoidance_delta_percent === "number", "missing token avoidance delta");
  assert(typeof m.comparison.scoped_refresh_index_ms_delta_percent === "number", "missing scoped refresh delta");
  assert(typeof m.comparison.scoped_main_index_chars_delta_percent === "number", "missing scoped index delta");
  assert(["passed", "failed", "unstable", "not_comparable"].includes(m.comparison.regression_status), "invalid regression status");
  assert(m.comparison.compatibility && m.comparison.compatibility.comparable, "comparison should be compatible");
  assert(m.comparison.regression_thresholds && m.comparison.regression_thresholds.scoped_refresh_index_ms_delta_percent, "missing regression thresholds");
}

function validateStatus(file, expectedStatus, expectedIssue) {
  const m = readJson(file);
  assert(m.comparison && m.comparison.regression_status === expectedStatus, `expected ${expectedStatus}`);
  if (expectedIssue) assert(m.comparison.compatibility.issues.includes(expectedIssue), `missing compatibility issue ${expectedIssue}`);
}

function validateMaskedRegression(file) {
  const m = readJson(file);
  assert(m.comparison && m.comparison.regression_status === "failed", "masked regression should fail");
  assert(Array.isArray(m.comparison.sample_repo_deltas) && m.comparison.sample_repo_deltas.length === 3, "missing sample repo deltas");
  assert(m.comparison.regressions.some((item) => item.metric === "sample_repo_worst_code_index_ms_delta_percent"), "missing worst sample repo regression");
}

function validateTrend(file) {
  const t = readJson(file);
  assert(t.schema_version === 1 && t.benchmark_schema_version === 9 && t.report_count === 2, "invalid trend report");
  assert(t.baseline_input.endsWith("benchmark.json"), "invalid trend baseline");
  assert(t.metrics && t.metrics.code_index_ms && t.metrics.scoped_refresh_index_ms && t.metrics.scoped_main_index_chars, "missing trend metrics");
  assert(Array.isArray(t.points) && t.points.length === 2 && t.points[0].order === 1, "invalid trend points");
}

function validateIncompatibleTrend(file) {
  const t = readJson(file);
  assert(t.report_count === 2 && t.comparable_report_count === 1, "unexpected incompatible trend counts");
  assert(t.metrics.code_index_ms.status === "n/a", "incompatible trend should not report code index status");
}

const [mode, file, expected] = process.argv.slice(2);
if (!mode || !file) {
  console.error("usage: benchmark-smoke.js <mode> <json-file> [expected]");
  process.exit(1);
}

if (mode === "full") validateFullReport(file);
else if (mode === "comparison") validateComparison(file);
else if (mode === "status") validateStatus(file, expected, process.argv[5]);
else if (mode === "masked-regression") validateMaskedRegression(file);
else if (mode === "trend") validateTrend(file);
else if (mode === "incompatible-trend") validateIncompatibleTrend(file);
else {
  console.error(`unknown benchmark validator mode: ${mode}`);
  process.exit(1);
}
