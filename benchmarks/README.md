# Benchmark Evidence

Project Librarian benchmark evidence is based on actual Codex JSONL usage and local wall-clock timing.

## Code performance efficiency harness

`npm run perf:code-efficiency` generates 3k/10k/50k code-evidence fixtures and writes `benchmarks/reports/code-performance-efficiency/current.json` plus `.md`. Command timings include CLI startup and freshness checks. The `query_groups` section is direct DB timing for representative file/symbol/route/import/edge queries, so query tuning can be evaluated separately after staleness cost is isolated. The report also writes `fts_variants` for benchmark-only current/contentless-delete/external-content FTS comparisons, including DB size deltas, query-plan details, and normalized search parity hashes. The `sample_corpora` section covers checked-in non-scale fixtures (`mixed-monorepo`, `web-service`, `python-cli`, and `docs-heavy`) so synthetic scale evidence and mixed sample evidence stay separate. Use repeated `--actual-repo <path>` options to add local real repositories to the same TS/Rust timing and row-delta report; each actual repository is measured from a temporary materialized copy so the source directory is not modified.

Use `--quick` only for harness diagnostics; quick reports are marked diagnostic-only for adoption decisions. Use `--report-dir <path>` for ad hoc reports that should not overwrite checked-in release evidence.

```sh
npm run build
node benchmarks/tools/code-performance-efficiency.js --quick --compare-native --native-strategy sqlite-direct --actual-repo /path/to/repo --report-dir /tmp/project-librarian-code-perf
```

For native strategy matrix evidence, keep `sqlite-direct` as the release-path baseline and audit the generated report before citing parity or speed direction. The strict audit options below require the expected corpus, every strategy to be available, zero row deltas, per-engine sample evidence for the requested run count, and a faster `sqlite-direct` median for every repo:

```sh
node benchmarks/tools/assert-native-strategy-matrix-report.js /tmp/native-strategy/full.json --repos cobra,flask,gin,laravel-framework,okhttp,requests,serde,spring-petclinic,symfony-console,tokio --min-repos 10 --min-runs 3 --require-sqlite-direct-faster
```

## Claim ledger

`npm run benchmark:claim-ledger` summarizes measured reports and payload previews into `release_claimable`, `diagnostic_only`, or `failed` rows per track and corpus. A passing claim gate is not enough for `release_claimable`; the report also needs a clean source-control provenance, explicit model, sanitized pack, `--require-clean`, `--require-claimable`, and enough runs for `min_runs_for_claim`. Payload previews are always `diagnostic_only` because they do not measure Codex output.

Claim-ledger schema v2 rows include companion Markdown evidence paths when a same-basename `.md` report exists, model sources, observed models, release blockers, and gate issues. These fields make the Markdown ledger reviewable without opening every JSON report; they do not change release classification.

## Guidance probe benchmark

`npm run benchmark:guidance:dry-run` validates the guidance probe corpus and writes an ignored manifest/Markdown report under `benchmarks/reports/guidance/` without launching Codex. The default corpus compares `current` and `refined_candidate` variants across startup-router, taxonomy, code-localization, stale-router, read-only, and multi-hop probes.

The `current` variant materializes tracked `AGENTS.md` plus the package's generated `startup` and `index` templates. It does not require the maintainer-local ignored `wiki/startup.md` or `wiki/index.md` files to exist in CI.

Measured runs use the focused runner directly:

```sh
npm run benchmark:guidance -- --variants current,refined_candidate --runs 3 --model gpt-5.5 --markdown --require-claimable
```

The measured report records variant digests, probe IDs, expected sources, raw JSONL paths, guidance coverage, localization hit rate, route compliance, unproductive action rate, read-only file-change counts, and a guidance claim gate. Claims are model- and agent-surface-scoped; a Codex-measured candidate does not transfer to Claude, Cursor, or Gemini without its own measured evidence. Use `--candidate-out .project-wiki/guidance-refinement/runs/<run-id>/candidate-guidance.md` when turning failures into the next candidate text. Reports under `benchmarks/reports/guidance/` are ignored by default.

## Dual-track benchmark

The benchmark measures two product tracks and reports them separately (no merged cross-track headline):

- **Wiki track** (`benchmark_track: wiki`) measures wiki canonical routing. Synthetic families: `onboarding`, `decision_lookup`, `code_impact`, `release_policy`, `change_location`, plus the A3 families `multi_session` and `aggregation` (see below). The first five answers are planted as doc-lookup sentences in both the with-Project-Librarian wiki and the control `docs/`, so they measure document routing. `code_impact` and `change_location` keep their names and prompts for comparability with the 2026-06-10 report even though they are wiki-track doc lookups.
- **Code-graph track** (`benchmark_track: code_graph`) measures the code-evidence index in the real-repository corpus (`--corpus real`). The current synthetic matrix no longer includes synthetic code-graph families; those historical fixtures were removed when the real-corpus harness became the code-graph owner.

The current synthetic full matrix is 7 task families across 3 scales × 2 conditions = 42 scenarios.

Both conditions share the same base repo, so the control can still answer code-graph questions by grepping `packages/` and `CODEOWNERS` — that is the intended comparison.

Code-graph correctness is computed deterministically at fixture-generation time and stored on each scenario in the manifest (`scenario.expectation`), so validators recompute correctness from raw JSONL plus the manifest-borne expectation rather than trusting stored verdicts. Expectations are scale-dependent: the deterministic inter-workspace dependency spine (workspace-`K` depends on workspace-`K-1`) means the transitive dependency set of the deepest workspace is the whole chain below it, and the intra-workspace import chain (`mod-K` imports `mod-(K-1)`) means the transitive importer set of `mod-0.ts` is the whole chain tail. See the A7 structural bounds section below for the full topology.

A **docs-only answerability gate** runs at fixture build time: for each code-graph scenario, the distinctive expected-answer key terms must appear in no `*.md` file under either condition root (including pages the product itself generates). A violation throws an error naming the file and term; there is no warn-and-continue.

### Historical A7 structural bounds (pre-real-corpus synthetic code graph)

This section documents the historical synthetic code-graph fixture design used before code-graph measurement moved to the real-repository corpus. The current synthetic matrix is wiki-only; use `--corpus real` for current code-graph measurements. The old code-graph fixtures encoded scale-proportional structural realism so the three questions required genuine traversal, not a single tiny read — fixtures encoded bounds, never a desired delta. Each scale carried explicit minimums that the generators met and a build-time `assertCodeStructureBounds` enforced (hard fail, no fallback, error names the violated bound):

- **CODEOWNERS rule count** scales with size (small ~20, medium ~80, large ~250+). The rules overlap by design — a catch-all `*`, interleaved extension rules (`*.go`, `*.ts`, …), per-workspace directory rules, per-workspace `src/` overrides, and a `/packages/workspace-0/src/service/` override — so the `ownership_lookup` answer requires evaluating **last-matching-rule-wins precedence**. The named path `packages/workspace-0/src/service/handler.go` is matched by five rules; the winning owner (`@benchmark-service-team`) is the last match, not the `*.go` extension owner a grep would report. A generation-time resolver computes the expected owner and the assert reconfirms it.
- **Cross-workspace dependency spine**: workspace `K` depends on workspace `K-1` through both a TypeScript bridge import edge and a matching `package.json` dependency (the two agree), forming a chain `workspace-0 <- workspace-1 <- … <- workspace-(W-1)`. The `workspace_graph` answer is the **transitive** dependency set of the deepest workspace, so it cannot be derived without traversing every hop (chain depth ≥2 at medium, ≥3 at large). Every scale — including small (now 4 workspaces) — is non-degenerate.
- **Intra-workspace import chain**: `packages/workspace-0/src/mod-0.ts <- mod-1.ts <- … <- mod-(C-1).ts`. The `impact_trace` answer is the **transitive importer set** of `mod-0.ts`; a grep finds only the one direct importer (`mod-1.ts`), so the rest of the chain requires following `from_file -> to_ref` edges. This chain exists at every scale, so `impact_trace` has a concrete, unambiguous multi-file answer at small too (the prior small-scale instability is fixed at the root).
- **Derivation-file count**: deriving each code-graph answer must read at least 5 distinct files at small, 10 at medium, and 20 at large. The assert verifies the real evidence files (chain modules for `impact_trace`; the leaf-to-root `package.json` + bridge files for `workspace_graph`; CODEOWNERS plus the full service-directory owned set for `ownership_lookup`) exist on disk and meet the minimum, so a control cannot answer from one read.

All these structures stay generic about owner handles and package/file paths in any planted Markdown — the deeper CODEOWNERS and dependency structure never leaks an answer string into the planted docs or the maintained wiki/router content, so the docs-only answerability gate keeps passing in every control profile. Correctness still requires every expected component (every transitive path, every owned file, the precedence-correct owner) to be present; the evaluator's substring matching tolerates path lists with or without backticks and in any order without weakening that requirement. The manifest schema stays `4`: the A7 changes alter the *content* of `scenario.expectation` for code-graph families (different transitive answers) but not its *shape*, and add no scenario fields.

The with-condition fixture installs the built Project Librarian CLI under `tools/project-librarian/` and converts the code-evidence index out of WAL journal mode so an agent can query it offline under the read-only sandbox. The fixture plants `wiki/canonical/code-evidence-query.md` with a **task-first pointer policy**: task-shaped commands (`--code-impact <term>`, `--code-report --code-report-section ownership`, `--code-report --code-report-section workspace-graph`) are advertised first, matching the product's shipped and documented interface; the raw SQL fallback (`--code-query`) and `--code-status` are listed last as advanced options. The pointer names command shapes only and never embeds an answer value (the docs-only gate rejects any page that leaks an answer key term into Markdown). Build-time verification runs all three task commands plus the SQL fallback against the generated index and hard-fails if any returns empty where the scoped index should have data. The control fixture does not install the runner.

Reports separate the two tracks: the report JSON gains `benchmark_tracks` and a `tracks.{wiki,code_graph}` structure, each with its own summary and claim gate. The overall `claim_gate` passes only if every present track passes; per-track gates are reported alongside it (`claim_gate.per_track`). The Markdown report renders separate Wiki Track and Code Graph Track sections with per-track delta tables. The manifest schema is `5` and the measured-report schema is `8`: the manifest bump to `5` adds the corpus dimension on top of `4` (A3 `multi_session` session fields and the `aggregation` expectation; the manifest carries fixture provenance only, no metrics, so the cost decomposition does not move it); the measured-report bump to `8` adds execution-order provenance on top of `7` (corpus dimension), `6` (A4 cost decomposition), `5` (A3 multi_session run/scenario fields), and `4` (A5 hermetic provenance block and per-run `fixture_validation`).

## Multi-session and aggregation families (A3)

Two wiki-track families measure the product thesis (compact maintained-wiki routing) rather than grep-optimal single-session point lookup:

- **`multi_session`** runs `codex exec` TWICE sequentially in the SAME fixture cwd. Both sessions are ephemeral and each gets its OWN isolated `CODEX_HOME` (Phase 2 hermetic machinery), so there is no shared codex state — the only amortization surface under test is the repository's own context surface (a maintained wiki vs scattered docs). Session 1 is a familiarization (onboarding-style) pass; session 2 is the measured decision/policy lookup, distinct from session 1's work. The manifest scenario carries a `sessions` array (`[{session_index:1, role:"familiarization", prompt, command}, {session_index:2, role:"measured", prompt, command}]`) plus `session_count`; the top-level `prompt`/`command` mirror the measured session (session 2) so single-prompt code paths resolve the measured question. **Session metric semantics:** session-2 metrics are the scenario's primary metrics (the scenario `median`/`dispersion`/`correctness` are all sourced from session 2), reported separately from session 1. Each measured run carries a `session_metrics` array with both sessions' metrics, executions, and raw JSONL paths, plus `measured_session_index`; the scenario carries a `session_metrics` summary array and a `sessions` prompt/command list. Correctness evaluates session 2's final text only — session 1 only needs to complete. Post-run fixture validation runs ONCE after BOTH sessions complete.
- **`aggregation`** asks for a fact answerable only by synthesizing across MULTIPLE planted planning pages: list every dated decision in chronological order. The dated-decision inventory is planted ONE-PER-PAGE in both conditions (with-condition under `wiki/canonical/dated-decision-*.md`; control under the profile's history directory), so the full ordered list lives on no single page. The ground truth is computed deterministically at fixture-generation time (fixed dates, no `Date.now()`) and embedded as `scenario.expectation` (the same manifest-borne mechanism as the code-graph families), so validators recompute correctness from raw JSONL plus the expectation rather than a stored verdict. The expectation carries `required_terms` (every date), `aggregate_components` (the ordered `[date, summary]` inventory), `no_single_page_terms` (the per-fact summaries), and profile-aware `evidence_by_condition`. A build-time **no-single-page-aggregate gate** (analogous to the docs-only gate) throws and names the offending file if any single Markdown page contains the full aggregate answer; individual facts may and should exist on their separate pages. The gate runs in every control profile. **Order tolerance:** correctness requires all aggregate dates present in the final text but does not enforce textual ordering, because the required synthesis (gathering all dates from scattered pages) is what the family measures and Codex final text rarely preserves an exact ordering.

## Cost decomposition and the cost-weighted headline (A4)

The measured report decomposes token usage instead of leading with merged total tokens. Three derived fields are recomputed from raw JSONL on every run (and every session of a `multi_session` run) and are never trusted from a stored report:

- `uncached_input_tokens` = `input_tokens - cached_input_tokens`. A fully cached resend (`cached == input`) legitimately yields `0`. Cached input that exceeds total input is corrupt usage data and fails the run loudly — it is never silently clamped.
- `tool_output_bytes` = the total UTF-8 byte length of command/tool stdout captured in the JSONL. Codex records captured command output in the `aggregated_output` string field of a `command_execution` item; that field is populated on the `item.completed` event (the `item.started` event carries an empty in-progress string), so the byte count comes from completed command/tool items only and a started/completed pair is never double counted. The forward-compatible fallbacks `output`/`stdout`/`result` on a command/tool item are also recognized, but at most one field is summed per event. This reproduces the published per-run tool-output volumes in the trace analysis (for example medium with-condition 73,487 bytes, large control 168,751 bytes).
- `request_count_estimate` = the count of completed provider turn boundaries (`turn.completed`/`turn.ended`), which a non-interactive `codex exec` emits once per request. If the JSONL exposes no turn boundary at all, the field is recorded as unavailable through the existing `unavailable_event_fields` mechanism rather than guessed from command/tool counts.

The per-track **headline metric** is cost-weighted tokens, not merged total tokens:

```
cost_weighted_tokens = uncached_input_tokens
                     + cache_discount * cached_input_tokens
                     + output_tokens
                     + reasoning_output_tokens
```

Cached input is discounted because a cached resend is far cheaper than fresh input, so counting it at full weight overstates cost and structurally penalizes any tool (such as Project Librarian) that adds turns whose input is mostly re-sent cached context. Merged total tokens does exactly that — it counts cached resends at full weight — so it is demoted to a clearly labeled **secondary** row in both the report JSON (the scenario `median` retains `total_tokens`, and the Markdown renders it only under a "Merged Total Tokens (secondary, not a headline)" heading) and is never used for a claim. The two tracks stay separated: there is no merged cross-track number anywhere near a headline, and for `multi_session` the headline sources from the session-2 (measured) metrics per the existing convention.

The cache discount is configurable with `--cache-discount <0..1>` (default `0.1`, i.e. cached resends count at 10% weight). `0` counts cached input as free; `1` counts it at full weight, collapsing the cost-weighted number toward merged total. Negative, `> 1`, and non-numeric values are rejected loudly. The chosen discount is recorded on the report at the top level (`cache_discount`) and in `configuration.cache_discount`, and the Markdown header states the discount it used so a reader can reproduce the headline arithmetic.

```sh
# default discount 0.1
npm run benchmark:llm:dry-run
# override the cached-resend weight (e.g. measure at full weight)
npm run benchmark:llm -- --allow-codex-run --sanitized-pack --cache-discount 1 --scales small --tasks decision_lookup --max-scenarios 2 --runs 1 --warmup-runs 0 --model gpt-5.5
```

## Maintained-wiki with-condition fixture (A1)

The with-condition fixture is a maintained wiki, not a bootstrap-default one. After bootstrap and page planting, the fixture generator overwrites `wiki/startup.md`, `wiki/decisions/recent.md`, and `wiki/index.md` with maintained content (the product CLI only writes those routers when absent, so the overwrites stick), then runs `--refresh-index` so the auto-index block reflects reality without clobbering the hand-written routes. The seeded dated decision in `wiki/decisions/log.md` is surfaced in `wiki/startup.md` Recent Project Decisions and in `wiki/decisions/recent.md` (never "None yet."), and the five wiki-track answer pages are hand-routed in `wiki/index.md` with one-line read-when hints. The routers stay within the session-hook budgets (`startup.md` 3500 chars, `index.md` 4500 chars). Two build-time asserts throw on violation, with no fallback: router-truth consistency (a non-empty decision log forbids "None yet." in startup/recent and requires the seeded date), and bounded answer reachability (`startup.md` -> `index.md` -> each answer page within two hops). The maintained router text stays generic about code topics so it never trips the docs-only answerability gate.

## Control profiles (A2)

The control (without Project Librarian) is materialized under one of three profiles, selected with `--control-profile` (default `organic`):

- `curated`: idealized per-topic flat docs under `docs/` (the historical control). Reported as an upper bound, not the default.
- `organic` (default): the same facts scattered across more files (handbook, operations, QA, runbook, architecture notes) surrounded by unrelated filler, plus at least two dated distractor decisions whose dates are strictly earlier than the seeded answer's date, so "latest decision" requires comparing dates rather than taking the first dated line.
- `bare`: a single unstructured `docs/NOTES.md` dump of all facts with no per-topic organization (answers exist but discovery is hardest).

All profiles share the same base code repo, and every wiki-family answer remains present and findable in each profile so correctness stays satisfiable. The manifest records `control_profile` at the top level and on every scenario, and the measured report carries it at the top level, in `configuration`, and on every scenario. Control-side correctness evidence is profile-aware (per-profile expected-evidence file lists); the with-condition evidence is unchanged.

```sh
npm run benchmark:llm:dry-run -- --control-profile organic
npm run benchmark:llm:dry-run -- --control-profile bare
npm run benchmark:llm:dry-run -- --control-profile curated
```

## Hermetic measurement (A5)

Measured Codex runs are hermetic, and this is always on for measured runs (it is not flag-gated); dry-run paths are unaffected. Before any measured scenario the runner:

- copies **only** the auth material (`auth.json`) from the real Codex home into a fresh per-run isolated `CODEX_HOME` under the run's raw output dir; nothing else is copied (no `config.toml`, so the `[plugins.*]` table never loads; no `plugins/`, no `agents/`, no `*.sqlite` state). If `auth.json` is absent the measured run fails at spawn time with a clear error and never falls back to the unisolated user home.
- builds the child process environment from an explicit allowlist (`PATH`, `HOME`, `CODEX_HOME`, and locale/`TERM` basics) instead of inheriting `process.env`, so user-level plugin/config toggles carried in the environment cannot reach the child. The auth-mode contract is preserved inside the allowlist: subscription mode forwards neither `CODEX_API_KEY` nor `OPENAI_API_KEY`, and `--auth-mode api-key` forwards whichever is present.
- with `--require-clean`, verifies the source tree is git-clean before the first measured scenario and fails hard listing the dirty paths (dry-run is unaffected).

After each measured run the runner re-fingerprints the fixture directory and compares it to the manifest fingerprint; any difference fails the run. Independently, the presence of any runtime-state directory/file (at minimum `.omx/`, `.omc/`, plus dotfile state dirs such as `.codex/`, `.claude/`, `.gemini/`, `.cursor/`) anywhere inside the fixture is a HARD FAILURE naming the offending paths — runtime state is never silently excluded from the fingerprint, because an isolation leak must fail the run.

The measured report records hermetic provenance in a top-level `hermetic` block (isolated Codex home path, real Codex home, auth source, copied files, allowlisted env key names and count, and `inherited_process_env: false`) and a per-run `fixture_validation` record (`status`, `runtime_state_paths`, `fingerprint_matched`). By default the runner prunes stale prior raw run directories older than 1 day before starting a measured run, prunes any remaining stale prior `codex-home*` directories older than 1 day, then prunes the current run's isolated homes after metrics and fixture validation finish. If a claimable run fails before report writing, the runner still writes `codex-home-retention.json` and prunes the current homes before exiting non-zero. Raw JSONL, stderr, reports, sanitized-pack manifests, and retention manifests are retained for runs inside the retention window; older timestamped raw run directories are deleted as a unit. Pass `--keep-codex-homes` only when debugging the current isolated home contents themselves; use `--no-auto-prune-raw-runs`, `--auto-prune-raw-runs-older-than-days <n>`, `--no-auto-prune-codex-homes`, or `--auto-prune-codex-homes-older-than-days <n>` only for retention-policy experiments.

Old ignored raw output can still be audited and cleaned later with the dry-run-first helper. The helper targets directories named `codex-home` or `codex-home-*` directly under `benchmarks/reports/llm/raw` or one timestamp directory below it; automatic raw-run cleanup additionally removes stale timestamped run directories as a unit.

```sh
npm run benchmark:llm:prune-raw -- --older-than-days 14
npm run benchmark:llm:prune-raw -- --older-than-days 14 --execute
```

## Codex injection sentinel (B1)

`benchmarks/tools/injection-sentinel.js` is an experiment script that tests whether `codex exec` runs the bootstrap's `.codex/hooks.json` SessionStart hook and injects `wiki/startup.md` into the session context. It bootstraps a tmp fixture, appends a unique `SENTINEL-` line to the fixture's `wiki/startup.md`, and (with `--allow-codex-run`) asks Codex to repeat any `SENTINEL-` line or answer `NO-INJECTION`, then judges the JSONL: a sentinel echoed before any file-read command means injection works; a sentinel echoed only after a file-read command, or a `NO-INJECTION` answer, means injection is absent; anything else is inconclusive. Raw JSONL is written under a tmp output dir, never under `benchmarks/reports/`. Without `--allow-codex-run` the script prints the exact procedure and exits with code `2` (`sentinel not run: pass --allow-codex-run`) and fabricates no result. The `npm run benchmark:injection-sentinel` script does not bake in the allow flag.

```sh
npm run benchmark:injection-sentinel
```

Current local measured report: `benchmarks/reports/llm/current-local.json` and `benchmarks/reports/llm/current-local.md`, generated 2026-06-10 after explicit approval to send benchmark fixtures and prompts to Codex. It used ChatGPT/Codex auth, `gpt-5.5`, `decision_lookup`, small/medium/large, one measured run per condition, and no warmup. Claim gate passed, but this is not a release baseline: the source tree was dirty and post-run fixture fingerprint validation needs a clean isolated rerun because runtime state files touched generated fixture directories. The observed deltas were small +71.55% tokens/+64.33% wall time, medium +109.02% tokens/+9.5% wall time, and large -6.67% tokens/+7.72% wall time for Project Librarian versus control.

Create the small/medium/large with-vs-without fixture manifest without launching Codex:

```sh
npm run benchmark:llm:dry-run
```

Preview the measured-run disclosure surface before launching Codex:

```sh
npm run benchmark:release:preview
```

The release scripts pin `--model gpt-5.5`; `--require-claimable` now fails before fixture execution when no model is requested. This avoids burning the full matrix only to discover that no auditable model provenance exists. When Codex JSONL exposes a single model, the report records `model_source=jsonl`; when current Codex JSONL omits model fields, a measured `codex exec --model <model>` command is recorded as `model_source=codex_cli_command` and claims are scoped to that requested CLI model. During measured execution, `--require-claimable` also fails fast on the first Codex process/session execution failure and prints the raw JSONL and stderr paths, instead of spending the whole matrix on runs that cannot become claimable. If the final claim gate fails because correctness or claimability did not pass, stderr prints scenario-level diagnostics: failed prompt id, run index, failed checks, raw JSONL/stderr paths, and a final-text excerpt. Measured runs stream `[benchmark:progress]` lines to stderr with the selected scenario count, expected Codex exec total, current exec ordinal, run phase, prompt id, exit status, elapsed time, and raw JSONL path; stdout remains the final machine-readable JSON.

`--payload-preview <path>` builds the selected fixture matrix and writes a local audit JSON without launching Codex or requiring `--allow-codex-run`. The preview includes every selected prompt, prompt hash, requested model, scenario cwd, expected Codex exec count, scenario run plan, fixture fingerprint, MCP injection flag, and the sanitized-pack provenance when enabled. It is intentionally a stop point: inspect the JSON first, then run the measured command separately.

For diagnostic reruns after a failed full release benchmark, use `--only-failed-from <report.json>` to select only the scenarios that failed the prior claim gate, or `--only-prompt-id <prompt_id[,prompt_id...]>` to select named scenarios directly. Diagnostic prompt filters record `configuration.diagnostic_selection` in previews and measured reports, but they cannot be combined with `--require-claimable` or `--full-matrix`: a diagnostic rerun is evidence for debugging a miss, not a public release claim. For example:

```sh
npm run benchmark:release:diagnose -- --allow-codex-run --only-failed-from benchmarks/reports/llm/current.json
```

For release-quality reruns where a prior measured report already contains claimable scenarios, use `--reuse-claimable-from <report.json>` with the full release command. This is not parallel execution: the runner reuses only measured runs whose report schema, manifest fingerprints, selected matrix, source commit, auth mode, model, run count, warmup count, scenario order, cache discount, control profile, fixture validation, execution order, raw JSONL, correctness, and claimability match the new run. Reused runs are rehydrated from raw JSONL and still pass through the normal report validator; incompatible reports fail before measurement. Warmups are still executed for the new run, but compatible measured runs are skipped and recorded under `configuration.reuse_claimable`.

```sh
npm run benchmark:release -- --allow-codex-run --reuse-claimable-from benchmarks/reports/llm/current.json
```

Use `--sanitized-pack` for measured runs that may leave the local machine. The runner copies only the benchmark harness (`benchmarks/codex-llm-metrics.js`, `benchmarks/lib/`, `dist/`, `package.json`, `benchmarks/real-keys/` when present, and the installed `typescript` runtime dependency) into a fresh temporary pack, then re-executes from that pack. Synthetic fixtures are built under the pack's `scratch/` directory, so Codex scenario cwd paths stay inside the minimized pack rather than the live source checkout. Raw JSONL, stderr, retention manifests, and measured reports still write under `benchmarks/reports/llm/` so report validators can re-read them after the pack run; isolated `codex-home*` directories are pruned unless `--keep-codex-homes` is present. The pack writes `SANITIZED_BENCHMARK_PACK.json` listing copied entries and excluded workspace roots. The re-exec path streams child output directly, so progress lines are visible while the minimized pack is running. This does not remove the need for human approval: a measured run still sends the listed prompts and any files Codex reads from each scenario cwd to the external service.

Validate the JSONL parser and report-shape checks against checked-in sample artifacts:

```sh
npm run benchmark:llm:parse-smoke
node tests/validators/codex-llm-benchmark-smoke.js benchmarks/llm/samples/codex-measured-report.json
```

Measured Codex execution is intentionally gated behind `--allow-codex-run` and uses `codex exec --json --ephemeral --sandbox read-only --skip-git-repo-check` because scenarios run from generated fixture directories. By default it runs one with/without pair to preserve comparison validity while limiting subscription quota use; use `--full-matrix` when the selected scales/tasks should all run. The default `--scenario-order run-major-balanced` executes all selected scenarios for a measured run index, then reverses the scenario order on alternating repetitions so repeated with/without runs are not grouped by condition. Pass `--scenario-order scenario-major` only to reproduce older scenario-grouped diagnostics. Pass `--max-scenarios`, `--runs`, and `--warmup-runs` deliberately when expanding coverage. Pass `--codex-timeout-ms <n>` to bound each individual `codex exec` child; the default `0` preserves the historical no-timeout behavior, while timed-out children are recorded as failed executions and make `--require-claimable` fail fast. Pass `--codex-execution-retries <n>` to retry Codex child execution failures such as transient CLI/API protocol errors; correctness failures and unclaimable completed runs are not retried, and previous failed attempts remain in the final run's `execution.previous_attempts`. Pass `--control-profile bare|organic|curated` (default `organic`) to choose the control fixture profile; the chosen profile is recorded on the manifest, report, and every scenario. Pass `--model <model>` for claimable runs; the report records model provenance as `jsonl`, `codex_cli_command`, or diagnostic-only `requested`. Pass `--markdown` to write the default Markdown summary or `--markdown <path>` for an explicit path. Pass `--keep-codex-homes` only when the isolated homes are themselves the debug target. Use `--require-clean` for public-claim candidates so source-control provenance starts from a clean checkout. Use `--require-claimable` so partial, failed, or unclaimable scenarios are written to disk but exit non-zero. Use `--min-runs-for-claim <n>` with `--require-claimable` when a public claim requires repeated runs. Report `median` values are computed only from claimable runs: execution must complete, correctness must pass, usage/model/final-text fields must be present, token counts and wall time must be positive, and the run must resolve to exactly one model. `median_all_runs` is retained for audit when a run fails, needs review, or lacks claimable measurement fields. Raw event counts and normalized invocation counts are reported separately so start/completed JSONL pairs do not inflate tool-call claims. Reports also include prompt/command provenance, source-control metadata, fixture fingerprints, selected-matrix fingerprints, full-manifest fingerprints, scenario run plan, per-run execution order, timing dispersion, plan-event counts, and first-response latency when Codex JSONL exposes timestamps; otherwise first-response latency is marked unavailable. The validator reparses raw JSONL and recomputes metrics, correctness, medians, dispersion, claim gate, selected matrix fingerprints, and selected manifest fingerprints before accepting a measured report.

```sh
npm run benchmark:llm -- --allow-codex-run --sanitized-pack --scales small --tasks decision_lookup --max-scenarios 2 --runs 1 --warmup-runs 0 --model gpt-5.5
```

Run the small/medium/large decision-lookup matrix and produce a README-ready Markdown summary:

```sh
npm run benchmark:llm -- --allow-codex-run --sanitized-pack --scales small,medium,large --tasks decision_lookup --full-matrix --runs 3 --warmup-runs 1 --min-runs-for-claim 3 --require-clean --require-claimable --model gpt-5.5 --out benchmarks/reports/llm/current.json --markdown benchmarks/reports/llm/current.md
```

Run every scale and every current task family only when the expected subscription quota use is acceptable:

```sh
npm run benchmark:llm -- --allow-codex-run --sanitized-pack --full-matrix --runs 3 --warmup-runs 1 --min-runs-for-claim 3 --require-clean --require-claimable --model gpt-5.5 --out benchmarks/reports/llm/current.json --markdown benchmarks/reports/llm/current.md
```

Subscription-authenticated runs fail if `CODEX_API_KEY` or `OPENAI_API_KEY` is present. Pass `--auth-mode api-key` only when intentionally running an API-key-priced benchmark. The report records declared auth mode plus non-secret auth-environment audit flags, but public claims still need human review when local Codex config could route through a profile not visible in environment variables. Reports under `benchmarks/reports/llm/` are ignored by default; commit only deliberate release evidence.

Commit policy:

- Commit release baselines that public release claims compare against.
- Generate release baselines from a clean checkout; dirty baselines are validation artifacts only.
- Commit Markdown summaries only when they are part of release evidence; `benchmarks/reports/*.json` and `benchmarks/reports/*.md` are ignored by default for ad hoc reports.
- Do not commit ad hoc current reports from local investigation.
- Keep temporary comparison outputs outside the repository or under an ignored scratch path.
