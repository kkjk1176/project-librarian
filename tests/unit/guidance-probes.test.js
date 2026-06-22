"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildGuidancePrompt,
  defaultGuidanceProbesPath,
  evaluateGuidanceClaimGate,
  evaluateGuidanceProbe,
  loadGuidanceProbeFile,
  selectGuidanceProbes,
  summarizeGuidanceRuns,
} = require("../../benchmarks/lib/guidance-probes");
const {
  defaultGuidanceVariantsPath,
  resolveGuidanceVariants,
} = require("../../benchmarks/lib/guidance-variants");

const root = path.resolve(__dirname, "..", "..");
const runner = path.join(root, "benchmarks", "tools", "guidance-probe-runner.js");

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "project-librarian-guidance-test-"));
}

test("guidance probes and variants load with current repo sources", () => {
  const probes = loadGuidanceProbeFile(defaultGuidanceProbesPath(root));
  assert.equal(probes.schema_version, 1);
  assert(probes.probes.length >= 6);
  const selected = selectGuidanceProbes(probes.probes, { taskFamilies: ["startup_router"] });
  assert.equal(selected.length, 1);

  const variants = resolveGuidanceVariants({
    root,
    variantsPath: defaultGuidanceVariantsPath(root),
    variantIds: ["current", "refined_candidate"],
  });
  assert.equal(variants.variants.length, 2);
  assert(variants.variants[0].digest.value.length >= 32);
  assert(variants.variants[0].source_contents.some((source) => source.path === "AGENTS.md"));
});

test("guidance prompt includes variant digest and probe task", () => {
  const probe = loadGuidanceProbeFile(defaultGuidanceProbesPath(root)).probes[0];
  const variant = resolveGuidanceVariants({
    root,
    variantsPath: defaultGuidanceVariantsPath(root),
    variantIds: ["refined_candidate"],
  }).variants[0];
  const prompt = buildGuidancePrompt({ probe, variant });
  assert(prompt.includes("Guidance Variant"));
  assert(prompt.includes(variant.digest.value));
  assert(prompt.includes(probe.prompt));
  assert(prompt.includes("Do not modify files"));
});

test("guidance evaluation tracks coverage, localization, route compliance, and read-only", () => {
  const probe = loadGuidanceProbeFile(defaultGuidanceProbesPath(root)).probes.find((item) => item.probe_id === "startup_router.context_map");
  const passed = evaluateGuidanceProbe({
    probe,
    metrics: { file_change_event_count: 0, command_invocation_count: 1, tool_invocation_count: 0, mcp_invocation_count: 0 },
    finalText: "Use wiki/startup.md for compact startup context and wiki/index.md as the router/read next map.",
  });
  assert.equal(passed.status, "passed");
  assert.equal(passed.metrics.localization_hit_rate, 1);
  assert.equal(passed.metrics.route_compliance, 1);
  assert.equal(passed.metrics.unproductive_action_rate, 0);

  const failed = evaluateGuidanceProbe({
    probe,
    metrics: { file_change_event_count: 1, command_invocation_count: 2, tool_invocation_count: 0, mcp_invocation_count: 0 },
    finalText: "I cannot access the repository.",
  });
  assert.equal(failed.status, "failed");
  assert.equal(failed.metrics.stall_signal, true);
  assert.equal(failed.metrics.unproductive_action_rate, 1);
  assert.equal(failed.metrics.read_only_file_change_count, 1);
});

test("guidance claim gate compares baseline and candidate variants", () => {
  function scenario(probeId, variantId, coverage, passed = true) {
    const guidance_evaluation = {
      status: passed ? "passed" : "failed",
      metrics: {
        guidance_coverage: coverage,
        localization_hit_rate: coverage,
        route_compliance: coverage,
        unproductive_action_rate: 0,
        read_only_file_change_count: 0,
        action_invocation_count: 1,
      },
    };
    return {
      probe_id: probeId,
      variant_id: variantId,
      runs: [{ guidance_evaluation }],
      summary: summarizeGuidanceRuns([{ guidance_evaluation }]),
    };
  }
  const report = {
    mode: "measured",
    configuration: { baseline_variant: "current", candidate_variant: "refined_candidate" },
    scenarios: [
      scenario("p1", "current", 0.5),
      scenario("p1", "refined_candidate", 0.7),
      scenario("p2", "current", 0.5),
      scenario("p2", "refined_candidate", 0.7),
      scenario("p3", "current", 0.5),
      scenario("p3", "refined_candidate", 0.7),
    ],
  };
  const gate = evaluateGuidanceClaimGate(report);
  assert.equal(gate.status, "passed");
  assert.equal(gate.complete_pair_count, 3);

  const regressed = {
    ...report,
    scenarios: [
      scenario("p1", "current", 0.8),
      scenario("p1", "refined_candidate", 0.7),
      scenario("p2", "current", 0.8),
      scenario("p2", "refined_candidate", 0.7),
      scenario("p3", "current", 0.8),
      scenario("p3", "refined_candidate", 0.7),
    ],
  };
  assert.equal(evaluateGuidanceClaimGate(regressed).status, "failed");
});

test("guidance probe runner dry-run writes report, markdown, and candidate artifact", () => {
  const dir = tmpDir();
  const out = path.join(dir, "report.json");
  const markdown = path.join(dir, "report.md");
  const candidate = path.join(dir, "candidate.md");
  const result = childProcess.spawnSync(process.execPath, [
    runner,
    "--dry-run",
    "--out", out,
    "--markdown", markdown,
    "--candidate-out", candidate,
  ], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(fs.readFileSync(out, "utf8"));
  assert.equal(report.kind, "project-librarian-guidance-probe-report");
  assert.equal(report.mode, "dry-run");
  assert.equal(report.claim_gate.status, "dry_run");
  assert(report.scenarios.length >= 12);
  assert(fs.readFileSync(markdown, "utf8").includes("Guidance Probe Report"));
  assert(fs.readFileSync(candidate, "utf8").includes("Candidate Guidance Refinement"));
});
