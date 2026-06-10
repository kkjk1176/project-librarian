"use strict";

const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");

const scales = {
  small: {
    wikiPages: 8,
    codeFiles: 50,
    workspaces: 1,
  },
  medium: {
    wikiPages: 80,
    codeFiles: 500,
    workspaces: 5,
  },
  large: {
    wikiPages: 500,
    codeFiles: 1500,
    workspaces: 12,
  },
};

const conditions = ["with_project_librarian", "without_project_librarian"];

const taskFamilies = {
  onboarding: "Summarize what this project is, current risks, and where to read next. Cite the files you used.",
  decision_lookup: "Find the latest decision about benchmark evidence policy, including the decision date. Cite the source file.",
  code_impact: "If benchmark report schema changes, what files or areas are likely impacted? Cite evidence.",
  release_policy: "What checks are required before publishing or making benchmark claims? Cite the policy.",
  change_location: "Where should an agent edit to implement a Codex LLM benchmark runner? Do not modify files.",
};

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function fingerprintDirectory(root) {
  const entries = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      if (entry.isDirectory()) {
        if ([".git", "node_modules"].includes(entry.name)) continue;
        visit(absolute);
      } else if (entry.isFile()) {
        entries.push(`${relative}\0${sha256(fs.readFileSync(absolute))}`);
      }
    }
  }
  visit(root);
  return {
    algorithm: "sha256-relative-path-content",
    value: sha256(entries.join("\n")),
    file_count: entries.length,
  };
}

function planningPage(index, scale) {
  return `---
status: active
updated: 2026-06-10
scope: benchmark-fixture
read_budget: short
decision_ref: none
review_trigger: benchmark fixture regeneration
---

# Fixture Planning Page ${index}

Project Librarian benchmark fact ${index} for ${scale}.

- Owner: benchmark-team-${index % 5}
- Risk: route drift ${index}
- Verification: npm run benchmark:llm:dry-run
`;
}

const codeProfiles = [
  {
    extension: "ts",
    directory: "src",
    content: (index, workspace) => `export function route${index}() {
  return {
    workspace: "${workspace}",
    route: "/benchmark/${index}",
    owner: "benchmark-team-${index % 5}",
  };
}
`,
  },
  {
    extension: "tsx",
    directory: "ui",
    content: (index) => `export function BenchmarkCard${index}() {
  return <section data-route="/benchmark/${index}">Benchmark ${index}</section>;
}
`,
  },
  {
    extension: "go",
    directory: "services",
    content: (index) => `package services

func BenchmarkRoute${index}() string {
	return "/benchmark/${index}"
}
`,
  },
  {
    extension: "py",
    directory: "tools",
    content: (index) => `def benchmark_route_${index}():
    return "/benchmark/${index}"
`,
  },
  {
    extension: "rs",
    directory: "workers",
    content: (index) => `pub fn benchmark_route_${index}() -> &'static str {
    "/benchmark/${index}"
}
`,
  },
  {
    extension: "java",
    directory: "java",
    content: (index) => `final class BenchmarkRoute${index} {
  String path() { return "/benchmark/${index}"; }
}
`,
  },
  {
    extension: "php",
    directory: "php",
    content: (index) => `<?php
function benchmark_route_${index}() {
    return "/benchmark/${index}";
}
`,
  },
  {
    extension: "kt",
    directory: "kotlin",
    content: (index) => `fun benchmarkRoute${index}(): String = "/benchmark/${index}"
`,
  },
  {
    extension: "swift",
    directory: "swift",
    content: (index) => `func benchmarkRoute${index}() -> String {
  return "/benchmark/${index}"
}
`,
  },
  {
    extension: "c",
    directory: "native",
    content: (index) => `const char* benchmark_route_${index}(void) {
  return "/benchmark/${index}";
}
`,
  },
  {
    extension: "cpp",
    directory: "native",
    content: (index) => `const char* benchmarkRoute${index}() {
  return "/benchmark/${index}";
}
`,
  },
  {
    extension: "cs",
    directory: "dotnet",
    content: (index) => `class BenchmarkRoute${index} {
  string Path() => "/benchmark/${index}";
}
`,
  },
  {
    extension: "yaml",
    directory: "config",
    content: (index) => `route: /benchmark/${index}
owner: benchmark-team-${index % 5}
`,
  },
  {
    extension: "json",
    directory: "config",
    content: (index) => `${JSON.stringify({ route: `/benchmark/${index}`, owner: `benchmark-team-${index % 5}` }, null, 2)}\n`,
  },
];

function sourcePathAndContent(index, workspace) {
  const profile = codeProfiles[index % codeProfiles.length];
  return {
    relativePath: path.join("packages", workspace, profile.directory, `route-${index}.${profile.extension}`),
    content: profile.content(index, workspace),
  };
}

function materializeBaseRepo(root, scaleName, condition) {
  const scale = scales[scaleName];
  if (!scale) throw new Error(`unknown scale: ${scaleName}`);

  fs.mkdirSync(root, { recursive: true });
  writeFile(path.join(root, "README.md"), `# ${scaleName} benchmark fixture

This fixture models a ${scaleName} repository for actual Codex LLM benchmark experiments.

Current benchmark evidence policy requires with-vs-without Project Librarian comparisons, measured token usage, tool-call counts, and correctness checks.
`);

  writeFile(path.join(root, "package.json"), `${JSON.stringify({
    name: `llm-benchmark-${scaleName}-${condition}`,
    private: true,
    type: "module",
    workspaces: ["packages/*"],
    dependencies: {
      "@benchmark/api": "workspace:*",
      express: "latest",
    },
  }, null, 2)}\n`);
  writeFile(path.join(root, "CODEOWNERS"), "/packages/workspace-0/ @benchmark-team-0\n*.go @go-benchmark-team\n*.py @python-benchmark-team\n");

  for (let index = 0; index < scale.codeFiles; index += 1) {
    const workspace = `workspace-${index % scale.workspaces}`;
    if (index < scale.workspaces) {
      writeFile(path.join(root, "packages", workspace, "package.json"), `${JSON.stringify({
        name: `@benchmark/${workspace}`,
        private: true,
        dependencies: {
          express: "latest",
        },
      }, null, 2)}\n`);
    }
    const source = sourcePathAndContent(index, workspace);
    writeFile(path.join(root, source.relativePath), source.content);
  }
}

function runProjectLibrarian(cliPath, args, cwd) {
  if (!cliPath || !fs.existsSync(cliPath)) {
    throw new Error("missing Project Librarian CLI; run npm run build before benchmark:llm:dry-run");
  }
  childProcess.execFileSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function materializeWithProjectLibrarian(root, scaleName, cliPath) {
  const scale = scales[scaleName];
  materializeBaseRepo(root, scaleName, "with_project_librarian");
  runProjectLibrarian(cliPath, ["--no-git-config"], root);

  for (let index = 0; index < scale.wikiPages; index += 1) {
    writeFile(path.join(root, "wiki", "canonical", `fixture-page-${index}.md`), planningPage(index, scaleName));
  }
  writeFile(path.join(root, "wiki", "canonical", "project-brief.md"), "# Project Brief\n\nProject Librarian benchmark fixture validates coding-agent onboarding, risks, and where to read next. Current risks include route drift, benchmark overclaiming, and stale code evidence. Read wiki/startup.md, wiki/index.md, and wiki/canonical/benchmark-and-release-evidence.md next.\n");
  writeFile(path.join(root, "wiki", "canonical", "benchmark-and-release-evidence.md"), "# Benchmark And Release Evidence\n\nActual LLM evidence compares with and without Project Librarian across small, medium, and large fixtures. Official claims require measured token usage, wall-clock time, command/tool invocation counts, full matrix coverage, claimable runs, and correctness checks.\n");
  writeFile(path.join(root, "wiki", "canonical", "release-policy.md"), "# Release Policy\n\nBefore publishing benchmark claims, run the full matrix with --full-matrix, require claimable output, validate raw JSONL with tests/validators/codex-llm-benchmark-smoke.js, and include Markdown plus JSON evidence.\n");
  writeFile(path.join(root, "wiki", "canonical", "code-impact.md"), "# Code Impact\n\nBenchmark report schema changes impact benchmarks/codex-llm-metrics.js, benchmarks/lib/codex-jsonl.js, benchmarks/lib/llm-report.js, benchmarks/lib/llm-correctness.js, and tests/validators/codex-llm-benchmark-smoke.js.\n");
  writeFile(path.join(root, "wiki", "canonical", "implementation-map.md"), "# Implementation Map\n\nEdit benchmarks/codex-llm-metrics.js for the Codex LLM benchmark runner, benchmarks/lib/llm-report.js for aggregation, and tests/validators/codex-llm-benchmark-smoke.js for validation.\n");
  writeFile(path.join(root, "wiki", "decisions", "log.md"), "# Decision Log\n\n- 2026-06-10 | metrics | actual LLM benchmark comparison adopted.\n");
  runProjectLibrarian(cliPath, ["--refresh-index"], root);
  runProjectLibrarian(cliPath, ["--code-index", "--code-scope", "packages", "--code-scope", "package.json", "--code-scope", "CODEOWNERS"], root);
}

function materializeWithoutProjectLibrarian(root, scaleName) {
  const scale = scales[scaleName];
  materializeBaseRepo(root, scaleName, "without_project_librarian");
  writeFile(path.join(root, "docs", "project-overview.md"), "# Project Overview\n\nThis benchmark fixture validates coding-agent onboarding, risks, and where to read next. Current risks include route drift, benchmark overclaiming, and stale code evidence. Read README.md, docs/benchmark-policy.md, and docs/release-policy.md next.\n");
  writeFile(path.join(root, "docs", "benchmark-policy.md"), "# Benchmark Policy\n\nActual LLM evidence compares tools by measured token usage, wall-clock time, command/tool-call counts, full matrix coverage, claimable runs, and correctness checks.\n");
  writeFile(path.join(root, "docs", "release-policy.md"), "# Release Policy\n\nBefore publishing benchmark claims, run the full matrix with --full-matrix, require claimable output, validate raw JSONL with tests/validators/codex-llm-benchmark-smoke.js, and include Markdown plus JSON evidence.\n");
  writeFile(path.join(root, "docs", "code-impact.md"), "# Code Impact\n\nBenchmark report schema changes impact benchmarks/codex-llm-metrics.js, benchmarks/lib/codex-jsonl.js, benchmarks/lib/llm-report.js, benchmarks/lib/llm-correctness.js, and tests/validators/codex-llm-benchmark-smoke.js.\n");
  writeFile(path.join(root, "docs", "implementation-map.md"), "# Implementation Map\n\nEdit benchmarks/codex-llm-metrics.js for the Codex LLM benchmark runner, benchmarks/lib/llm-report.js for aggregation, and tests/validators/codex-llm-benchmark-smoke.js for validation.\n");
  writeFile(path.join(root, "docs", "decisions.md"), "# Decisions\n\n- 2026-06-10: actual LLM benchmark comparison adopted.\n");
  for (let index = 0; index < scale.wikiPages; index += 1) {
    writeFile(path.join(root, "docs", "planning", `fixture-page-${index}.md`), planningPage(index, scaleName));
  }
}

function promptFor(taskFamily, scale, condition) {
  const prompt = taskFamilies[taskFamily];
  if (!prompt) throw new Error(`unknown task family: ${taskFamily}`);
  return [
    `Benchmark scenario: ${scale} / ${condition} / ${taskFamily}.`,
    "Work as a coding agent in this repository.",
    "Use only local repository evidence.",
    "Do not modify files unless explicitly asked.",
    prompt,
  ].join("\n");
}

function codexCommand(prompt, requestedModel = "") {
  const command = ["codex", "exec", "--json", "--ephemeral", "--sandbox", "read-only", "--skip-git-repo-check"];
  if (requestedModel) command.push("--model", requestedModel);
  command.push(prompt);
  return command;
}

function buildScenarioManifest({ fixtureRoot, scale, condition, taskFamily, requestedModel = "" }) {
  const cwd = path.join(fixtureRoot, scale, condition);
  const prompt = promptFor(taskFamily, scale, condition);
  return {
    scale,
    condition,
    task_family: taskFamily,
    prompt_id: `${taskFamily}-${scale}-${condition}`,
    cwd,
    prompt,
    requested_model: requestedModel || null,
    fixture_fingerprint: fingerprintDirectory(cwd),
    command: codexCommand(prompt, requestedModel),
  };
}

function materializeFixturePair(fixtureRoot, scale, cliPath) {
  const withRoot = path.join(fixtureRoot, scale, "with_project_librarian");
  const withoutRoot = path.join(fixtureRoot, scale, "without_project_librarian");
  materializeWithProjectLibrarian(withRoot, scale, cliPath);
  materializeWithoutProjectLibrarian(withoutRoot, scale);
}

function buildManifest({ fixtureRoot, cliPath, selectedScales = Object.keys(scales), selectedTasks = Object.keys(taskFamilies), requestedModel = "" }) {
  const scenarios = [];
  for (const scale of selectedScales) {
    materializeFixturePair(fixtureRoot, scale, cliPath);
    for (const condition of conditions) {
      for (const taskFamily of selectedTasks) {
        scenarios.push(buildScenarioManifest({ fixtureRoot, scale, condition, taskFamily, requestedModel }));
      }
    }
  }

  return {
    schema_version: 1,
    benchmark_kind: "codex-actual-llm-manifest",
    generated_at: new Date().toISOString(),
    fixture_root: fixtureRoot,
    scales: selectedScales,
    conditions,
    task_families: selectedTasks,
    requested_model: requestedModel || null,
    manifest_fingerprint: sha256(JSON.stringify(scenarios.map((scenario) => ({
      scale: scenario.scale,
      condition: scenario.condition,
      task_family: scenario.task_family,
      prompt: scenario.prompt,
      fixture_fingerprint: scenario.fixture_fingerprint,
      requested_model: scenario.requested_model,
    })))),
    scenarios,
  };
}

module.exports = {
  buildManifest,
  conditions,
  materializeFixturePair,
  scales,
  taskFamilies,
};
