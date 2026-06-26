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

Cost-weighted tokens, Project Librarian vs control:

| Scale | decision_lookup | aggregation | multi_session (2nd session) |
| --- | --- | --- | --- |
| Small | 14.4% less | 81.0% more | 22.0% less |
| Medium | 52.0% less | 19.0% less | 54.1% less |
| Large | 71.1% less | 29.0% less | 71.8% less |

Latest synthetic wiki-track release candidate: 2026-06-19, `gpt-5.5`, 42 scenarios, 3 measured runs plus 1 warmup each. The overall claim gate **passed**: 42/42 scenarios passed correctness, all 42 scenarios were claimable, and every corpus gate met the 3-run minimum.

The release claim is bounded to the synthetic wiki-routing track and the listed task families. It is not a claim about code-graph behavior, real repositories, every agent surface, or every question shape. Published boundaries remain visible: small `aggregation` still costs 81.0% more with the wiki, small `release_policy` costs 9.4% more in the full report, and `aggregation` stays slower at every scale even when token cost drops.

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

- **decision_lookup** - find the latest project decision and its date from the wiki.
- **aggregation** - answer a question whose facts are scattered across several pages and must be synthesized.
- **multi_session** - a second session on the same project, measuring whether the durable wiki helps the next session, not just the first.
- **impact_trace** - trace the full set of direct and indirect importers for a changing module.
- **ownership_lookup** - resolve the owner by CODEOWNERS last-match precedence.
- **workspace_graph** - resolve the workspace/package dependency graph.

## Maintainer Commands

Maintainer benchmark commands also live in [benchmarks/README.md](../benchmarks/README.md). They are for release evidence and public claim validation, not normal end-user setup.
