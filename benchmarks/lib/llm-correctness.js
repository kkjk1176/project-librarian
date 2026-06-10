"use strict";

// A2: control-side evidence expectations are profile-aware. The
// with_project_librarian side is unchanged (it always cites the maintained
// wiki). The control side (without_project_librarian) depends on which control
// profile materialized the fixture, because the same facts live in different
// files per profile:
//   - curated: idealized per-topic docs/ files (today's behavior, upper bound).
//   - organic: facts scattered across handbook/runbook/architecture/notes files.
//   - bare:    a single unstructured docs/NOTES.md dump.
// evidence_by_condition.without_project_librarian carries one array-of-groups per
// profile; evaluateCorrectness selects the active profile's list. Each group
// passes if the agent's final text cites any file in the group, so the lists
// point at the files where each fact actually lives in that profile.
const expectations = {
  onboarding: {
    required_terms: ["benchmark"],
    any_terms: [["risk", "where to read", "read next", "evidence"]],
    evidence_by_condition: {
      with_project_librarian: [["wiki/startup.md", "wiki/index.md", "wiki/canonical/project-brief.md"]],
      without_project_librarian: {
        curated: [["README.md", "docs/project-overview.md", "docs/benchmark-policy.md"]],
        organic: [["README.md", "docs/handbook/engineering.md", "docs/handbook/operations.md"]],
        bare: [["README.md", "docs/NOTES.md"]],
      },
    },
    forbidden_terms: ["I cannot access"],
  },
  decision_lookup: {
    required_terms: ["2026-06-10", "benchmark"],
    any_terms: [["decision", "metrics"]],
    evidence_by_condition: {
      with_project_librarian: [["wiki/decisions/log.md", "wiki/canonical/benchmark-and-release-evidence.md"]],
      without_project_librarian: {
        curated: [["docs/decisions.md", "docs/benchmark-policy.md"]],
        organic: [["docs/notes/decision-log.md"]],
        bare: [["docs/NOTES.md"]],
      },
    },
    forbidden_terms: ["I cannot access"],
  },
  code_impact: {
    required_terms: ["benchmark", "schema"],
    any_terms: [["report", "runner", "tests"]],
    evidence_by_condition: {
      with_project_librarian: [["wiki/canonical/code-impact.md"], ["benchmarks/codex-llm-metrics.js", "benchmarks/lib/llm-report.js"], ["tests/validators/codex-llm-benchmark-smoke.js"]],
      without_project_librarian: {
        curated: [["docs/code-impact.md"], ["benchmarks/codex-llm-metrics.js", "benchmarks/lib/llm-report.js"], ["tests/validators/codex-llm-benchmark-smoke.js"]],
        organic: [["docs/architecture/modules.md"], ["benchmarks/codex-llm-metrics.js", "benchmarks/lib/llm-report.js"], ["tests/validators/codex-llm-benchmark-smoke.js"]],
        bare: [["docs/NOTES.md"], ["benchmarks/codex-llm-metrics.js", "benchmarks/lib/llm-report.js"], ["tests/validators/codex-llm-benchmark-smoke.js"]],
      },
    },
    forbidden_terms: ["I cannot access"],
  },
  release_policy: {
    required_terms: ["benchmark", "claim"],
    any_terms: [["release", "verification", "test", "full-matrix"]],
    evidence_by_condition: {
      with_project_librarian: [["wiki/canonical/release-policy.md", "wiki/canonical/benchmark-and-release-evidence.md"], ["--full-matrix"], ["tests/validators/codex-llm-benchmark-smoke.js"]],
      without_project_librarian: {
        curated: [["docs/release-policy.md", "docs/benchmark-policy.md"], ["--full-matrix"], ["tests/validators/codex-llm-benchmark-smoke.js"]],
        organic: [["docs/runbooks/release.md"], ["--full-matrix"], ["tests/validators/codex-llm-benchmark-smoke.js"]],
        bare: [["docs/NOTES.md"], ["--full-matrix"], ["tests/validators/codex-llm-benchmark-smoke.js"]],
      },
    },
    forbidden_terms: ["I cannot access"],
  },
  change_location: {
    required_terms: ["benchmark"],
    any_terms: [["benchmarks/codex-llm-metrics.js", "benchmarks/lib/llm-report.js"], ["tests/validators/codex-llm-benchmark-smoke.js"]],
    evidence_by_condition: {
      with_project_librarian: [["wiki/canonical/implementation-map.md"], ["benchmarks/codex-llm-metrics.js"]],
      without_project_librarian: {
        curated: [["docs/implementation-map.md"], ["benchmarks/codex-llm-metrics.js"]],
        organic: [["docs/architecture/modules.md"], ["benchmarks/codex-llm-metrics.js"]],
        bare: [["docs/NOTES.md"], ["benchmarks/codex-llm-metrics.js"]],
      },
    },
    forbidden_terms: ["I cannot access"],
  },
  // A3 multi_session: correctness evaluates the MEASURED session (session 2) only;
  // session 1 (familiarization) only needs to complete. Session 2 asks the combined
  // release-policy-plus-latest-decision question, so a correct answer must mention
  // a benchmark claim/check (release policy) and the seeded latest decision date.
  // Evidence is profile-aware on the control side, exactly as the single-session
  // wiki families: with-condition cites the maintained wiki pages, the control
  // cites the profile's policy/decision files.
  multi_session: {
    required_terms: ["benchmark", "2026-06-10"],
    any_terms: [["claim", "check", "publish", "release"], ["decision", "latest"]],
    evidence_by_condition: {
      with_project_librarian: [["wiki/canonical/release-policy.md", "wiki/canonical/benchmark-and-release-evidence.md"], ["wiki/decisions/log.md", "wiki/decisions/recent.md"]],
      without_project_librarian: {
        curated: [["docs/release-policy.md", "docs/benchmark-policy.md"], ["docs/decisions.md"]],
        organic: [["docs/runbooks/release.md"], ["docs/notes/decision-log.md"]],
        bare: [["docs/NOTES.md"]],
      },
    },
    forbidden_terms: ["I cannot access"],
  },
};

const evidenceByCondition = {
  with_project_librarian: ["wiki/", "AGENTS.md"],
  without_project_librarian: ["README.md", "docs/", "packages/"],
};

// code_graph families share the same base repo in both conditions and are
// answered from code evidence (packages/, CODEOWNERS, tools/ runner output),
// so the condition-evidence signal is the code surface rather than the wiki or
// docs split used by the wiki families.
const codeGraphEvidenceByCondition = {
  with_project_librarian: ["packages/", "CODEOWNERS", ".project-wiki", "tools/project-librarian", "imports", "configs"],
  without_project_librarian: ["packages/", "CODEOWNERS"],
};

function includesInsensitive(text, term) {
  return text.toLowerCase().includes(term.toLowerCase());
}

// Resolve the expectation for a task family. Most wiki families use the static
// expectations map. code_graph families and the wiki aggregation family have no
// static entry and require a scenario-provided expectation (computed at fixture
// build time and stored in the manifest/report) so the validator can recompute
// correctness from raw JSONL plus the manifest-borne expectation rather than
// trusting stored verdicts. multi_session resolves through the static map keyed
// by task_family ("multi_session"), sourcing its final text from session 2.
function resolveExpectation(taskFamily, scenarioExpectation) {
  const staticExpectation = expectations[taskFamily];
  if (staticExpectation) return { expectation: staticExpectation, source: "static" };
  if (scenarioExpectation && typeof scenarioExpectation === "object") {
    return { expectation: scenarioExpectation, source: "scenario" };
  }
  return { expectation: null, source: "missing" };
}

// Resolve the expected-evidence groups for a condition. The control side may be
// profile-keyed (an object of profile -> array-of-groups) or a plain
// array-of-groups; the with-condition side is a plain array-of-groups. A
// profile-keyed control side is supported for BOTH static wiki families and the
// scenario-source wiki aggregation family, because aggregation embeds the same
// profile-aware evidence shape in its manifest expectation. code_graph scenarios
// are evidence-checked through their condition-evidence map (the shared code
// surface) rather than per-page evidence groups, so this resolver is wiki-track
// only; code_graph passes benchmarkTrack === "code_graph" and gets [] here, which
// preserves its prior behavior exactly. Throws if a profile-keyed control side
// lacks the requested profile, so a typo or missing profile fails loudly.
function resolveExpectedEvidenceGroups(expectation, condition, controlProfile, benchmarkTrack) {
  if (benchmarkTrack === "code_graph") return [];
  const raw = expectation.evidence_by_condition?.[condition];
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  const groups = raw[controlProfile];
  if (!groups) {
    throw new Error(`missing control-profile evidence for profile "${controlProfile}" on condition ${condition}`);
  }
  return groups;
}

// Select the condition-evidence term set (which file roots a correct answer should
// cite for a condition). code_graph scenarios share the base repo, so both
// conditions point at the code surface; wiki families (static or the aggregation
// scenario family) use the wiki-vs-docs split. The benchmark track drives this,
// not the expectation source, so the wiki aggregation family (scenario-source)
// still gets the wiki evidence map rather than the code-graph one.
function conditionEvidenceMapFor(benchmarkTrack) {
  return benchmarkTrack === "code_graph" ? codeGraphEvidenceByCondition : evidenceByCondition;
}

function evaluateCorrectness({ taskFamily, condition, finalText, fileChangeCount = 0, readOnly = true, expectation: scenarioExpectation = null, controlProfile = "organic", benchmarkTrack = "wiki" }) {
  const resolved = resolveExpectation(taskFamily, scenarioExpectation);
  const expectation = resolved.expectation;
  if (!expectation) {
    return {
      status: "needs_review",
      reason: `missing expectation for task family: ${taskFamily}`,
      checks: [],
    };
  }
  const conditionEvidenceMap = conditionEvidenceMapFor(benchmarkTrack);

  const checks = [];
  const text = finalText || "";

  for (const term of expectation.required_terms) {
    checks.push({
      name: `required term: ${term}`,
      passed: includesInsensitive(text, term),
    });
  }

  for (const terms of expectation.any_terms) {
    checks.push({
      name: `any term: ${terms.join(" | ")}`,
      passed: terms.some((term) => includesInsensitive(text, term)),
    });
  }

  for (const term of expectation.forbidden_terms) {
    checks.push({
      name: `forbidden term absent: ${term}`,
      passed: !includesInsensitive(text, term),
    });
  }

  const evidenceTerms = conditionEvidenceMap[condition] || [];
  checks.push({
    name: `condition evidence: ${evidenceTerms.join(" | ")}`,
    passed: evidenceTerms.length === 0 || evidenceTerms.some((term) => includesInsensitive(text, term)),
  });

  for (const terms of resolveExpectedEvidenceGroups(expectation, condition, controlProfile, benchmarkTrack)) {
    checks.push({
      name: `expected evidence: ${terms.join(" | ")}`,
      passed: terms.some((term) => includesInsensitive(text, term)),
    });
  }

  if (readOnly) {
    checks.push({
      name: "read-only zero file changes",
      passed: fileChangeCount === 0,
    });
  }

  const missingFinalText = !text.trim();
  const failed = checks.filter((check) => !check.passed);
  if (missingFinalText) {
    return {
      status: "needs_review",
      reason: "final text unavailable in Codex JSONL",
      checks,
    };
  }
  return {
    status: failed.length === 0 ? "passed" : "failed",
    reason: failed.length === 0 ? "" : `${failed.length} correctness checks failed`,
    checks,
  };
}

module.exports = {
  codeGraphEvidenceByCondition,
  evaluateCorrectness,
  evidenceByCondition,
  expectations,
};
