"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  attachTraceDrilldowns,
  focusNotes,
  renderMarkdownAnalysis,
  scenarioDeltaRows,
} = require("../../benchmarks/tools/analyze-llm-deltas");

function scenario(scale, task, condition, median) {
  return {
    scale,
    task_family: task,
    condition,
    benchmark_track: "wiki",
    corpus: "synthetic",
    median,
  };
}

test("delta analysis ranks cost-weighted regressions and explains weighted drivers", () => {
  const report = {
    configuration: { cache_discount: 0.1 },
    scenarios: [
      scenario("small", "aggregation", "with_project_librarian", {
        uncached_input_tokens: 200,
        cached_input_tokens: 1000,
        output_tokens: 50,
        reasoning_output_tokens: 0,
        tool_output_bytes: 300,
        wall_ms: 2000,
        command_invocation_count: 4,
      }),
      scenario("small", "aggregation", "without_project_librarian", {
        uncached_input_tokens: 100,
        cached_input_tokens: 100,
        output_tokens: 25,
        reasoning_output_tokens: 0,
        tool_output_bytes: 100,
        wall_ms: 1000,
        command_invocation_count: 2,
      }),
      scenario("large", "onboarding", "with_project_librarian", {
        uncached_input_tokens: 50,
        cached_input_tokens: 0,
        output_tokens: 10,
        reasoning_output_tokens: 0,
        tool_output_bytes: 10,
        wall_ms: 500,
        command_invocation_count: 1,
      }),
      scenario("large", "onboarding", "without_project_librarian", {
        uncached_input_tokens: 100,
        cached_input_tokens: 0,
        output_tokens: 10,
        reasoning_output_tokens: 0,
        tool_output_bytes: 20,
        wall_ms: 1000,
        command_invocation_count: 2,
      }),
    ],
  };

  const rows = scenarioDeltaRows(report);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].scale, "small");
  assert.equal(rows[0].task_family, "aggregation");
  assert(rows[0].cost_delta_percent > 100);
  assert.equal(rows[0].drivers[0].label, "uncached input");
  assert.equal(rows[0].drivers[1].label, "cached input");

  const notes = focusNotes(rows);
  assert.match(notes.join("\n"), /Small aggregation/);
  const markdown = renderMarkdownAnalysis(report, rows, {
    generatedAt: "2026-06-19T00:00:00.000Z",
    source: "fixture.json",
    minRegressionPercent: 0,
  });
  assert.match(markdown, /small \| aggregation/);
  assert.match(markdown, /uncached input/);
});

function writeJsonl(filePath, commands) {
  const lines = commands.map((command, index) => JSON.stringify({
    type: "item.completed",
    item: {
      id: `item_${index}`,
      type: "command_execution",
      command: command.command,
      aggregated_output: command.output,
      exit_code: 0,
      status: "completed",
    },
  }));
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`);
}

test("trace drilldown classifies representative raw command output", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "llm-delta-trace-"));
  const withRaw = path.join(tmp, "with.jsonl");
  const withoutRaw = path.join(tmp, "without.jsonl");
  writeJsonl(withRaw, [
    { command: "sed -n '1,220p' wiki/startup.md", output: "router".repeat(10) },
    { command: "rg -n \"decision\" wiki", output: "wiki hit\n".repeat(200) },
    { command: "sed -n '1,80p' wiki/meta/wiki-ops-v1-decisions.md", output: "meta".repeat(20) },
  ]);
  writeJsonl(withoutRaw, [
    { command: "rg --files", output: "README.md\n" },
    { command: "sed -n '1,80p' docs/history/dated-decision-0.md", output: "dated".repeat(20) },
  ]);

  const report = {
    configuration: { cache_discount: 0.1 },
    scenarios: [
      {
        ...scenario("small", "aggregation", "with_project_librarian", {
          uncached_input_tokens: 200,
          cached_input_tokens: 1000,
          output_tokens: 50,
          reasoning_output_tokens: 0,
          tool_output_bytes: 1930,
          wall_ms: 2000,
          command_invocation_count: 3,
        }),
        runs: [{ metrics: { tool_output_bytes: 1930, command_invocation_count: 3 } }],
        raw_jsonl_paths: [withRaw],
      },
      {
        ...scenario("small", "aggregation", "without_project_librarian", {
          uncached_input_tokens: 100,
          cached_input_tokens: 100,
          output_tokens: 25,
          reasoning_output_tokens: 0,
          tool_output_bytes: 110,
          wall_ms: 1000,
          command_invocation_count: 2,
        }),
        runs: [{ metrics: { tool_output_bytes: 110, command_invocation_count: 2 } }],
        raw_jsonl_paths: [withoutRaw],
      },
    ],
  };

  const rows = attachTraceDrilldowns(report, scenarioDeltaRows(report));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].trace.with_project_librarian.top_commands[0].category, "broad_wiki_search");
  assert(rows[0].trace.diagnosis.some((note) => note.includes("broad wiki search")));

  const markdown = renderMarkdownAnalysis(report, rows, {
    generatedAt: "2026-06-19T00:00:00.000Z",
    source: "fixture.json",
    minRegressionPercent: 0,
  });
  assert.match(markdown, /Trace Drilldown/);
  assert.match(markdown, /broad_wiki_search/);
});
