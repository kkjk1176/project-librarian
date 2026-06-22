#!/usr/bin/env node
"use strict";

const costWeight = {
  cachedInput: 0.1,
  uncachedInput: 1,
};

function estimateTokens(text) {
  return Math.ceil(String(text).length / 4);
}

function costWeightedTokens({ cachedInput = 0, uncachedInput = 0 }) {
  return Math.round((cachedInput * costWeight.cachedInput + uncachedInput * costWeight.uncachedInput) * 100) / 100;
}

function fixture() {
  const startup = [
    "# Startup",
    "- Read wiki/startup.md and wiki/index.md first.",
    "- Route detailed project truth on demand.",
  ].join("\n");
  const index = [
    "# Index",
    "- canonical/: current truth.",
    "- plans/: execution plans.",
    "- decisions/: rationale.",
  ].join("\n");
  const pointer = [
    "## .project-wiki/session/last-handoff.md",
    "Local session handoff exists. Inspect it with: project-librarian --handoff-show",
  ].join("\n");
  const full = [
    "## Full Session Handoff (opt-in generated reference)",
    "Goal: finish session handoff.",
    "Current State: implementation is ready for verification.",
    "Next Actions: run tests; review release gate; commit.",
  ].join("\n");
  return { full, index, pointer, startup };
}

function condition(name, text, notes) {
  const uncachedInput = estimateTokens(text);
  return {
    name,
    char_count: text.length,
    estimated_tokens: uncachedInput,
    estimated_cost_weighted_tokens: costWeightedTokens({ uncachedInput }),
    notes,
  };
}

function buildSessionHandoffResumePreview() {
  const data = fixture();
  const base = [data.startup, data.index].join("\n\n");
  return {
    kind: "project-librarian-session-handoff-resume-preview",
    schema_version: 1,
    claim_status: "diagnostic_fixture_only",
    default_full_injection: false,
    token_policy: "cost-weighted = uncached input + 0.1 * cached input; this preview uses uncached static input only",
    conditions: [
      condition("project_librarian_only", base, "Startup/index only."),
      condition("project_librarian_plus_handoff_pointer", [base, data.pointer].join("\n\n"), "Default handoff behavior: pointer only."),
      condition("project_librarian_plus_full_handoff_injection", [base, data.pointer, data.full].join("\n\n"), "Opt-in experiment only; full handoff is capped by startup hooks."),
    ],
  };
}

function main() {
  process.stdout.write(`${JSON.stringify(buildSessionHandoffResumePreview(), null, 2)}\n`);
}

if (require.main === module) {
  main();
}

module.exports = {
  buildSessionHandoffResumePreview,
  costWeightedTokens,
  estimateTokens,
};
