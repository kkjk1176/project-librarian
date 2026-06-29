# Benchmark Evidence

These numbers are maintainer release evidence, not a blanket promise. Every value is real Codex JSONL usage and local wall-clock time (ChatGPT/Codex auth, `gpt-5.5`), measured hermetically: isolated Codex home, allowlist-only environment, clean tree, post-run fixture validation, with 3 measured runs plus 1 warmup per scenario against an `organic` control that has no Project Librarian.

The wiki-routing track and the code-graph track are measured and reported separately. A win on one never backs a claim about the other.

## Reproduce A Release Candidate

```bash
npm run benchmark:release:preview
npm run benchmark:release -- --allow-codex-run
```

Measured release runs stream `[benchmark:progress]` lines to stderr for the scenario count, expected Codex exec total, current exec ordinal, phase, prompt id, exit status, elapsed time, and raw JSONL path. stdout stays reserved for the final JSON result.

Generated benchmark reports under `benchmarks/reports/llm/` are ignored by default. Maintainers should commit deliberate release baselines only when they are meant to support a public claim.

## Wiki Track

Latest clean synthetic wiki-track release evidence: 2026-06-29, `gpt-5.5`, branch `perf/small-repo-code-evidence-safeguards` at `ae79390`, 42 scenarios, 21 with/without pairs, 3 measured runs plus 1 warmup each. The overall claim gate **passed**, and the claim ledger classified the report as release-claimable. A repair run reused 125 claimable measured runs from retained raw JSONL and remeasured the remaining failed slot.

Cost-weighted tokens, Project Librarian vs control, all scales combined:

| Task family | Delta |
| --- | ---: |
| onboarding | 65.95% less |
| decision_lookup | 48.46% less |
| code_impact | 55.61% less |
| release_policy | 58.22% less |
| change_location | 29.59% less |
| multi_session | 52.58% less |
| aggregation | 42.53% less |

Scale-specific cost-weighted token deltas:

| Task family | Small | Medium | Large |
| --- | ---: | ---: | ---: |
| onboarding | 60.88% less | 65.53% less | 69.17% less |
| decision_lookup | 19.18% less | 51.29% less | 60.12% less |
| code_impact | 26.61% less | 54.81% less | 68.43% less |
| release_policy | 30.23% less | 62.16% less | 67.26% less |
| change_location | 7.79% less | 2.86% more | 57.27% less |
| multi_session | 54.29% more | 35.32% less | 82.77% less |
| aggregation | 7.66% less | 51.32% less | 49.17% less |

The release claim is bounded to the synthetic wiki-routing track and the listed task families. It is not a claim about code-graph behavior, real repositories, every agent surface, or every question shape. Published boundaries remain visible: small `multi_session` and medium `change_location` cost more with the wiki in the cost-weighted token metric. `code_impact`, `change_location`, and `aggregation` also still have wall-time or command-count regressions in this report, even though token and output-byte metrics improved at the task-family aggregate level.

## Code-Graph Track

Measured on two SHA-pinned open-source repositories with hand-authored answer keys and the answer-shaped MCP tools injected into the hermetic Codex home. The claim gate passed with 30/30 runs correct after two evaluator false positives were fixed and the report was re-scored from raw JSONL; recompute-from-raw is the standing audit policy.

Cost-weighted tokens, Project Librarian vs control:

| Question | excalidraw (~1.2k files) | backstage (~11.8k files) |
| --- | --- | --- |
| impact_trace | 117% more | **27.7% less** |
| workspace_graph | 106% more | 2.6% less |
| ownership_lookup | - | 99% more |

The claim is a scale crossover, and the losses are published next to the win. On the 11.8k-file repository the tool wins the expensive traversal question (`impact_trace` 27.7% fewer cost-weighted tokens, 24.5% fewer scan bytes) and breaks even on the workspace graph, but everything loses on the small repository and cheap lookups (CODEOWNERS ownership) lose at every measured scale.

## Benchmark Names

Repositories under test:

- **excalidraw** - a real open-source whiteboard/diagramming app (~1.2k files); the small-repo data point.
- **backstage** - Spotify's open-source developer-portal platform (~11.8k files); the large-repo data point.

Question types:

- **onboarding** - summarize what the project is, current risks, and where to read next.
- **decision_lookup** - find the latest project decision and its date from the wiki.
- **code_impact** - identify likely impacted files or areas for a benchmark report schema change.
- **release_policy** - find the checks required before publishing or making benchmark claims.
- **change_location** - find where an agent should edit to implement the Codex LLM benchmark runner.
- **aggregation** - answer a question whose facts are scattered across several pages and must be synthesized.
- **multi_session** - a second session on the same project, measuring whether the durable wiki helps the next session, not just the first.
- **impact_trace** - trace the full set of direct and indirect importers for a changing module.
- **ownership_lookup** - resolve the owner by CODEOWNERS last-match precedence.
- **workspace_graph** - resolve the workspace/package dependency graph.

## Maintainer Commands

Maintainer benchmark commands also live in [benchmarks/README.md](../benchmarks/README.md). They are for release evidence and public claim validation, not normal end-user setup.
