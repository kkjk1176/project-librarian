"use strict";

const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");

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

function sourceFile(index, workspace) {
  return `export function route${index}() {
  return {
    workspace: "${workspace}",
    route: "/benchmark/${index}",
    owner: "benchmark-team-${index % 5}",
  };
}
`;
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
  }, null, 2)}\n`);

  for (let index = 0; index < scale.codeFiles; index += 1) {
    const workspace = `workspace-${index % scale.workspaces}`;
    writeFile(path.join(root, "packages", workspace, "src", `route-${index}.ts`), sourceFile(index, workspace));
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
  writeFile(path.join(root, "wiki", "canonical", "benchmark-and-release-evidence.md"), "# Benchmark And Release Evidence\n\nActual LLM evidence compares with and without Project Librarian across small, medium, and large fixtures.\n");
  writeFile(path.join(root, "wiki", "decisions", "log.md"), "# Decision Log\n\n- 2026-06-10 | metrics | actual LLM benchmark comparison adopted.\n");
  runProjectLibrarian(cliPath, ["--refresh-index"], root);
}

function materializeWithoutProjectLibrarian(root, scaleName) {
  const scale = scales[scaleName];
  materializeBaseRepo(root, scaleName, "without_project_librarian");
  writeFile(path.join(root, "docs", "benchmark-policy.md"), "# Benchmark Policy\n\nActual LLM evidence compares tools by measured token usage, tool-call counts, and correctness checks.\n");
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
