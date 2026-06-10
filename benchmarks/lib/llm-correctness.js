"use strict";

const expectations = {
  onboarding: {
    required_terms: ["benchmark"],
    any_terms: [["risk", "where to read", "read next", "evidence"]],
    evidence_by_condition: {
      with_project_librarian: [["wiki/startup.md", "wiki/index.md", "wiki/canonical/project-brief.md"]],
      without_project_librarian: [["README.md", "docs/project-overview.md", "docs/benchmark-policy.md"]],
    },
    forbidden_terms: ["I cannot access"],
  },
  decision_lookup: {
    required_terms: ["2026-06-10", "benchmark"],
    any_terms: [["decision", "metrics"]],
    evidence_by_condition: {
      with_project_librarian: [["wiki/decisions/log.md", "wiki/canonical/benchmark-and-release-evidence.md"]],
      without_project_librarian: [["docs/decisions.md", "docs/benchmark-policy.md"]],
    },
    forbidden_terms: ["I cannot access"],
  },
  code_impact: {
    required_terms: ["benchmark", "schema"],
    any_terms: [["report", "runner", "tests"]],
    evidence_by_condition: {
      with_project_librarian: [["wiki/canonical/code-impact.md"], ["benchmarks/codex-llm-metrics.js", "benchmarks/lib/llm-report.js"], ["tests/validators/codex-llm-benchmark-smoke.js"]],
      without_project_librarian: [["docs/code-impact.md"], ["benchmarks/codex-llm-metrics.js", "benchmarks/lib/llm-report.js"], ["tests/validators/codex-llm-benchmark-smoke.js"]],
    },
    forbidden_terms: ["I cannot access"],
  },
  release_policy: {
    required_terms: ["benchmark", "claim"],
    any_terms: [["release", "verification", "test", "full-matrix"]],
    evidence_by_condition: {
      with_project_librarian: [["wiki/canonical/release-policy.md", "wiki/canonical/benchmark-and-release-evidence.md"], ["--full-matrix"], ["tests/validators/codex-llm-benchmark-smoke.js"]],
      without_project_librarian: [["docs/release-policy.md", "docs/benchmark-policy.md"], ["--full-matrix"], ["tests/validators/codex-llm-benchmark-smoke.js"]],
    },
    forbidden_terms: ["I cannot access"],
  },
  change_location: {
    required_terms: ["benchmark"],
    any_terms: [["benchmarks/codex-llm-metrics.js", "benchmarks/lib/llm-report.js"], ["tests/validators/codex-llm-benchmark-smoke.js"]],
    evidence_by_condition: {
      with_project_librarian: [["wiki/canonical/implementation-map.md"], ["benchmarks/codex-llm-metrics.js"]],
      without_project_librarian: [["docs/implementation-map.md"], ["benchmarks/codex-llm-metrics.js"]],
    },
    forbidden_terms: ["I cannot access"],
  },
};

const evidenceByCondition = {
  with_project_librarian: ["wiki/", "AGENTS.md"],
  without_project_librarian: ["README.md", "docs/", "packages/"],
};

function includesInsensitive(text, term) {
  return text.toLowerCase().includes(term.toLowerCase());
}

function evaluateCorrectness({ taskFamily, condition, finalText, fileChangeCount = 0, readOnly = true }) {
  const expectation = expectations[taskFamily];
  if (!expectation) {
    return {
      status: "needs_review",
      reason: `missing expectation for task family: ${taskFamily}`,
      checks: [],
    };
  }

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

  const evidenceTerms = evidenceByCondition[condition] || [];
  checks.push({
    name: `condition evidence: ${evidenceTerms.join(" | ")}`,
    passed: evidenceTerms.length === 0 || evidenceTerms.some((term) => includesInsensitive(text, term)),
  });

  for (const terms of expectation.evidence_by_condition?.[condition] || []) {
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
  evaluateCorrectness,
  expectations,
};
