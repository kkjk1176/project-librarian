# Maintainer Guide

This page collects development and release-operation details that are too deep for the README first screen.

## Development

The source is TypeScript. The committed `dist/` directory is the compiled JavaScript used by the npm binary and installed skill copies.

```bash
npm install
npm run typecheck
npm run build
npm run check:dist
npm test
npm run test:coverage
npm run benchmark:llm:raw-audit
npm run benchmark:llm:delta-analysis
npm run benchmark:claim-ledger
npm run release:check
npm pack --dry-run
```

When editing TypeScript under `src/`, rebuild before committing so `dist/` stays current. `npm run check:dist` verifies that the checked-in generated files still match the latest build output.

`npm run test:coverage` uses Node's native test coverage with conservative line, branch, and function thresholds so coverage is a regression gate, not only a report.

The supported runtime floor is Node.js 22.13+. Development type definitions should stay aligned with the Node 22 support contract or be backed by a Node 22 compatibility check so TypeScript does not admit APIs unavailable to supported users.

## Release Readiness

`npm run release:check` is a local-only maintainer gate. It runs tests, native Node coverage, benchmark parser smoke, the real-corpus offline demo, benchmark release preview, benchmark claim-ledger classification, raw hygiene audit, package dry-run inspection, native helper package-matrix, binary-format, and SHA-256 provenance-manifest inspection, dist executable/parity checks, README benchmark-claim boundary checks, documentation CLI reference coverage, README/README.ko code-evidence freshness/scale-gate documentation checks, and trusted-publishing workflow checks.

It never publishes, never deletes raw benchmark artifacts, and never launches a measured Codex benchmark.

Treat a green `release:check` as a reproducible release-readiness bundle, not a runtime guarantee. It proves those local gates on the current checkout, including that the package dry run stays inside the expected publish boundary, excludes source files, tests, repo-local wiki/workflow state, raw benchmark output, and local caches, and does not contain a partial, mislabeled, unmanifested, stale-manifest, or checksum-mismatched `dist/native/` helper matrix.

## Publishing

Publishing is handled by `.github/workflows/publish.yml` after a GitHub Release is published. Non-OIDC jobs verify the source package, build each supported native helper, assemble `dist/native/`, generate the helper manifest, and run `release:check` against the helper-including package.

The final publish job targets the protected `npm-publish` GitHub Environment, uses npm trusted publishing through GitHub OIDC (`id-token: write`) and `npm publish --access public`, and generates npm provenance automatically. It must not use `NODE_AUTH_TOKEN` or npm token secrets, and release-critical first-party GitHub Actions are pinned to full commit SHAs. `release:check` verifies this workflow contract locally.

Trusted publishing and npm provenance prove the package was published through that GitHub OIDC workflow. They do not prove benchmark correctness, code-evidence freshness in an end-user repository, or a security audit; those remain separate evidence tracks.

## Code-Evidence Runtime Checks

For code-evidence runtime/storage checks, `npm run perf:code-efficiency` generates 3k/10k/50k fixtures and writes `benchmarks/reports/code-performance-efficiency/current.json` plus `.md`. Command timings include CLI startup and freshness checks; the `query_groups` section reports direct DB timings for representative file/symbol/route/import/edge queries.

The report also measures checked-in `mixed-monorepo`, `web-service`, `python-cli`, and `docs-heavy` corpora separately from synthetic scale fixtures. Add repeated `--actual-repo <path>` options with `--compare-native` to include local real repositories in the same TypeScript/Rust timing and row-delta report without modifying the source directories.

For actual-repository native policy checks:

```bash
npm run perf:code-full-rebuild -- --source-root <dir> --helper <helper>
npm run perf:code-incremental -- --source-root <dir> --helper <helper>
```

The first command compares forced TypeScript and Rust full rebuilds on fresh repo copies. The second compares TypeScript incremental updates against the Rust incremental writer after controlled file mutations.

## Benchmark Raw Output

Measured LLM benchmark runs automatically prune stale prior raw run directories and isolated Codex homes older than 1 day, then prune the current run's homes even on claimable-run failure. Raw JSONL, stderr, reports, and manifests remain for runs inside the retention window.

Old ignored raw output can still be audited with the dry-run-first helper before deleting retained isolated Codex homes:

```bash
npm run benchmark:llm:raw-audit -- --older-than-days 14
npm run benchmark:llm:prune-raw -- --older-than-days 14
npm run benchmark:llm:prune-raw -- --older-than-days 14 --execute
```

`npm run benchmark:llm:delta-analysis` reads the checked-in measured LLM report and ranks cost-weighted regressions without launching Codex. Add `-- --include-traces` to include representative raw JSONL command traces and classify broad-search/router-read drivers. It is the first diagnostic stop for weak cells such as small-scale aggregation before adding new benchmark claims.

Measured LLM runs default to `--scenario-order run-major-balanced`: each measured run index executes all selected scenarios, reversing the order on alternating repetitions so with/without pairs are not grouped by condition across repeated runs. Use `--scenario-order scenario-major` only when reproducing older scenario-grouped diagnostics.

`npm run typecheck:ts7` is an opt-in TypeScript 7 RC compatibility probe. It uses `npx` and is intentionally outside `test`, `release:check`, and CI gates until the compiler API and this project's TypeScript extractor have a measured parity record.
