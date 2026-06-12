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
// answered from code evidence (packages/, CODEOWNERS, tools/ runner output).
// workspace_graph answers always cite @benchmark/workspace-* package names
// (workspace package.json identifiers) as their code-surface evidence; those
// names are accepted as equivalent to a file-path citation, so they are listed
// alongside packages/ and CODEOWNERS as valid evidence tokens.
const codeGraphEvidenceByCondition = {
  with_project_librarian: ["packages/", "CODEOWNERS", ".project-wiki", "tools/project-librarian", "imports", "configs", "@benchmark/workspace-"],
  without_project_librarian: ["packages/", "CODEOWNERS", "@benchmark/workspace-"],
};

function includesInsensitive(text, term) {
  return text.toLowerCase().includes(term.toLowerCase());
}

// Designation matcher for ownership_lookup forbidden-team checks.
//
// Pure substring presence cannot distinguish two legitimate answer shapes:
//   (a) CORRECT: agent shows the full CODEOWNERS precedence chain as evidence,
//       quoting overridden rules like "*.go @go-benchmark-team" in a list, then
//       designates @benchmark-service-team as the winner.  Must PASS.
//   (b) WRONG: agent designates @go-benchmark-team as the owner of the queried
//       path, even if @benchmark-service-team is mentioned elsewhere.  Must FAIL.
//
// Strategy: split the response into individual lines (the natural unit for
// CODEOWNERS rule citations and ownership statements).  A line "designates" a
// team as owner when ALL of the following hold:
//   1. The line contains the forbidden team handle.
//   2. After stripping filename tokens ("codeowners", "code-owners") that
//      contain "owner" as a substring, the line still contains a standalone
//      designation signal word ("owner", "owned", "owns").  The strip step
//      prevents the common agent pattern `*.go @go-team at CODEOWNERS:2` from
//      triggering on the "owner" inside "codeowners".
//   3. The line is NOT a rule-chain enumeration entry.  Agents that explain
//      last-match-wins precedence enumerate each matching rule with its owner
//      in a structured list (e.g. "Line 33: `/packages` matches, owner
//      `@backstage/framework-maintainers`").  Such lines mention the intermediate
//      owner only as evidence for the chain, not as the final designation.
//      A line is treated as a rule-chain enumeration (and skipped) when it
//      matches either of:
//        • "Line N:" / "line N:" at the start of the trimmed line (numbered rule)
//        • a backtick-wrapped path pattern followed by "matches" anywhere on the line
//      These patterns capture both the "Line N: ..." format (backstage real-corpus)
//      and the "- `pattern` matches, owner `@team`" format (synthetic stage2b).
//   4. The line does NOT also contain the correct owner handle — if both appear,
//      the line is explaining the precedence override ("*.go → @go-team, but
//      service/ → @service-team wins"), which is fine.
//
// CODEOWNERS rule-list lines look like:
//   "*.go @go-benchmark-team"                              → no designation word → pass
//   "- `*.go @go-benchmark-team` at CODEOWNERS:2"         → "owner" only in "codeowners" → pass
//   "Line 33: `/packages` matches, owner `@framework-team`" → rule-chain enumeration → pass
//   "- `/packages/` matches, owner `@framework-team`"     → rule-chain enumeration → pass
//   "The owner is @go-benchmark-team"                     → standalone "owner" → FAIL
//   "@go-benchmark-team owns .go but @service wins"       → correct owner present → pass
//
// This is deliberately conservative: only lines that explicitly designate the
// wrong team as owner (without also naming the correct winner) fail.
//
// Rule-chain enumeration detection is additive: any line that was previously
// passing (no designation signal) continues to pass unchanged.
function isDesignatedOwner(text, forbiddenTeam, correctOwner) {
  const forbiddenLower = forbiddenTeam.toLowerCase();
  const correctLower = correctOwner.toLowerCase();
  // Designation signal words indicating an ownership assignment.
  const designationSignals = ["owner", "owned", "owns"];
  for (const rawLine of text.toLowerCase().split("\n")) {
    if (!rawLine.includes(forbiddenLower)) continue;
    // Strip filename substrings that contain "owner" but are not a role word,
    // so that "codeowners:2" or "code-owners" do not match the signal check.
    const line = rawLine.replace(/code[-_]?owners/g, "");
    const hasDesignationSignal = designationSignals.some((signal) => line.includes(signal));
    if (!hasDesignationSignal) continue;
    // Skip rule-chain enumeration lines: these mention an intermediate owner
    // as evidence for precedence reasoning, not as the final designation.
    // Pattern 1: "Line N:" or "line N:" at the start of the trimmed line.
    // Pattern 2: a backtick-wrapped path/pattern followed by "matches" anywhere.
    const trimmed = line.trimStart();
    if (/^line\s+\d+\s*:/.test(trimmed)) continue;
    if (/`[^`]+`\s+matches/.test(line)) continue;
    // The line designates an owner.  Pass if the correct owner is also on the
    // line (the agent is explaining the override, not reporting the wrong winner).
    if (!rawLine.includes(correctLower)) return true;
  }
  return false;
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

// Resolve the condition-evidence terms for a specific run.
//
// For real-corpus scenarios the synthetic fixture constants (codeGraphEvidenceByCondition)
// are wrong: they were authored for the benchmark fixture repo (packages/, CODEOWNERS,
// .project-wiki, @benchmark/workspace-*) which has nothing to do with the real repo
// under test.  Real-corpus answer keys embed their own evidence_by_condition arrays in
// the scenario expectation — e.g. ["packages/", "plugins/", "stringifyEntityRef"] for
// a backstage impact-trace question.  When the expectation carries a per-condition
// array (not a profile-keyed object), use it directly.
//
// For synthetic scenarios the expectation.evidence_by_condition is absent or contains
// profile-keyed control objects, so we fall back to the track-level map exactly as
// before.  This change is additive: synthetic correctness is unchanged.
function resolveConditionEvidenceTerms(benchmarkTrack, condition, expectation) {
  if (expectation && expectation.evidence_by_condition) {
    const raw = expectation.evidence_by_condition[condition];
    // Real-corpus answer keys embed a flat string array of evidence terms for each
    // condition — use them verbatim.  Distinguish from the static-expectation shape,
    // where evidence_by_condition carries per-group arrays (array-of-arrays used by
    // resolveExpectedEvidenceGroups, not here): check that every element is a string.
    if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === "string") return raw;
  }
  // Synthetic path: use the track-level map.
  const map = conditionEvidenceMapFor(benchmarkTrack);
  return map[condition] || [];
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

  // designation_forbidden: line-scoped ownership designation check for
  // ownership_lookup.  Each entry { team, correct_owner } fails if any line in
  // the response designates `team` as the owner of the queried path without also
  // citing `correct_owner` as the override winner on that same line.  This lets
  // agents show the full CODEOWNERS precedence chain (citing overridden rules) as
  // evidence without penalty, while still failing agents that report the wrong
  // team as the final owner.  See isDesignatedOwner for the exact decision rule.
  for (const { team, correct_owner: correctOwner } of expectation.designation_forbidden || []) {
    checks.push({
      name: `not designated owner: ${team}`,
      passed: !isDesignatedOwner(text, team, correctOwner),
    });
  }

  const evidenceTerms = resolveConditionEvidenceTerms(benchmarkTrack, condition, expectation);
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
