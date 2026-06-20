"use strict";

const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");

// Each scale carries the wiki + base-repo generation bounds. wikiPages drives the
// maintained/control wiki planting; codeFiles and workspaces drive the base code
// repo (route files plus per-workspace package.json), which still exists so the
// fixtures look like real repositories even though the synthetic code_graph track
// has been removed (the real-repository corpus now owns the code_graph track).
const scales = {
  small: {
    wikiPages: 8,
    codeFiles: 50,
    workspaces: 4,
  },
  medium: {
    wikiPages: 80,
    codeFiles: 500,
    workspaces: 6,
  },
  large: {
    wikiPages: 500,
    codeFiles: 1500,
    workspaces: 12,
  },
};

const conditions = ["with_project_librarian", "without_project_librarian"];

const benchmarkTracks = ["wiki", "code_graph"];

// Every task family carries an explicit benchmark_track. All synthetic families
// are wiki track: their answers are planted as doc-lookup sentences in both
// conditions, so they measure document routing, not code evidence. code_impact
// and change_location keep their names and prompts unchanged for comparability
// with the 2026-06-10 report even though they are wiki-track doc lookups. The
// change_location prompt explicitly asks for file citations because the evaluator
// requires evidence from the implementation map. The code_graph track lives
// entirely in the real-repository corpus
// (benchmarks/lib/real-corpus.js); the synthetic matrix is wiki-only.
const taskFamilyDefinitions = {
  onboarding: {
    benchmark_track: "wiki",
    prompt: "Summarize what this project is, current risks, and where to read next. Cite the files you used.",
  },
  decision_lookup: {
    benchmark_track: "wiki",
    prompt: "Find the latest decision about benchmark evidence policy, including the decision date. Cite the source file.",
  },
  code_impact: {
    benchmark_track: "wiki",
    prompt: "If benchmark report schema changes, what files or areas are likely impacted? Cite evidence.",
  },
  release_policy: {
    benchmark_track: "wiki",
    prompt: "What checks are required before publishing or making benchmark claims? Cite the policy.",
  },
  change_location: {
    benchmark_track: "wiki",
    prompt: "Where should an agent edit to implement a Codex LLM benchmark runner? Cite the source files. Do not modify files.",
  },
  // A3 (Phase 3 remainder). Both stay on the wiki track because they exercise the
  // product thesis (compact maintained-wiki routing) rather than code evidence.
  //
  // multi_session runs codex exec TWICE in the SAME fixture cwd. Both sessions are
  // ephemeral with their own isolated CODEX_HOME (no shared codex state), so the
  // only amortization surface under test is the repository's own context surface
  // (a maintained wiki vs scattered docs). Session 1 is an onboarding-style
  // familiarization pass; session 2 is the measured policy lookup, distinct from
  // session 1's work. The measured metrics come from session 2; session 1 only
  // needs to complete. `prompt` here is the session-2 (measured) prompt so the
  // single-prompt code paths (report scenario.prompt, llm-correctness static map)
  // continue to resolve the measured question.
  multi_session: {
    benchmark_track: "wiki",
    prompt: "What checks are required before publishing or making benchmark claims, and what is the latest dated decision about benchmark evidence policy? Cite the source files. Do not modify files.",
    multi_session: {
      familiarization_prompt: "Summarize what this project is, its current risks, and where to read next for benchmark evidence policy. Cite the files you used. Do not modify files.",
    },
  },
  // aggregation is answerable only by synthesizing facts scattered across MULTIPLE
  // planted planning pages: list every dated decision in chronological order. The
  // full ordered answer exists on no single page in either condition (build-time
  // assert), while the individual dated facts do live on their own pages. Ground
  // truth is computed deterministically per scale and control profile at
  // fixture-generation time and embedded as scenario.expectation (same mechanism
  // as code_graph families), so the validator recomputes correctness from raw
  // JSONL plus the manifest-borne expectation rather than a stored verdict.
  aggregation: {
    benchmark_track: "wiki",
    prompt: "List every dated decision recorded in this project's planning docs, in chronological order (earliest first), each with its date. Cite the source files. Do not modify files.",
  },
};

const taskFamilies = Object.fromEntries(
  Object.entries(taskFamilyDefinitions).map(([family, definition]) => [family, definition.prompt]),
);

const taskTracks = Object.fromEntries(
  Object.entries(taskFamilyDefinitions).map(([family, definition]) => [family, definition.benchmark_track]),
);

function trackForTaskFamily(taskFamily) {
  const track = taskTracks[taskFamily];
  if (!track) throw new Error(`unknown task family: ${taskFamily}`);
  return track;
}

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
  const relativePath = path.join("packages", workspace, profile.directory, `route-${index}.${profile.extension}`);
  return {
    relativePath,
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

  for (let index = 0; index < scale.codeFiles; index += 1) {
    const workspaceIndex = index % scale.workspaces;
    const workspace = `workspace-${workspaceIndex}`;
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

function markdownFilesUnder(root) {
  const found = [];
  function visit(directory) {
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if ([".git", "node_modules"].includes(entry.name)) continue;
        visit(absolute);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        found.push(absolute);
      }
    }
  }
  visit(root);
  return found.sort();
}

// A3 no-single-page-aggregate gate (throws on violation, no fallback). Analogous
// to the docs-only gate but for the aggregation family: the full aggregate answer
// must not be pre-aggregated on any single Markdown page in either condition.
// Individual facts may and should exist on their separate pages; what is forbidden
// is one page that contains EVERY component of the aggregate answer. The gate
// checks two distinct term sets so it catches both the prose-summary shape (all
// dated-decision summaries co-occurring) and the date-enumeration shape (all date
// strings co-occurring — empirically the most common violation: a single history
// page lists every date without prose summaries). terms is passed as either:
//   - the expectation's no_single_page_terms list (prose summaries), or
//   - the expectation's required_terms list (date strings)
// Callers in materializeFixturePair invoke it TWICE — once per term set — so
// BOTH shapes are blocked. If either page contains ALL terms in EITHER set,
// this throws and names the offending file and matched set.
function assertNoSinglePageAggregate(root, terms) {
  const components = (terms || []).filter(Boolean);
  if (components.length < 2) return;
  for (const filePath of markdownFilesUnder(root)) {
    const content = fs.readFileSync(filePath, "utf8");
    if (components.every((term) => content.includes(term))) {
      const relative = path.relative(root, filePath).split(path.sep).join("/");
      const matched = components.join(", ");
      throw new Error(`no-single-page-aggregate gate failed: Markdown file ${relative} contains all ${components.length} aggregate components [${matched}]; the aggregation answer must require synthesizing facts scattered across multiple pages, not exist pre-aggregated on one page`);
    }
  }
}

// The code-evidence index lives under the product's managed directory; this
// mirrors codeEvidenceDirectory + the default --code-index-out in
// src/code-index.ts. Kept here so the benchmark can locate the generated index
// without importing TypeScript.
function codeEvidenceRelativeDatabasePath() {
  return path.join(".project-wiki", "code-evidence.sqlite");
}

// Convert the generated code-evidence index out of WAL journal mode so the
// product CLI can query it under a read-only sandbox. The with-condition build
// has write access here; after this conversion a plain read-write open with
// PRAGMA query_only=ON (the CLI's query path) succeeds on a read-only
// filesystem. Without this, opening a WAL-mode database read-write on a
// read-only filesystem fails with "attempt to write a readonly database".
function convertCodeIndexForReadOnlyQuery(databaseAbsolutePath) {
  if (!fs.existsSync(databaseAbsolutePath)) {
    throw new Error(`expected code evidence index was not generated: ${databaseAbsolutePath}`);
  }
  const { DatabaseSync } = require("node:sqlite");
  const previousListeners = process.listeners("warning");
  const suppressExperimentalSqliteWarning = (warning) => {
    if (warning.name !== "ExperimentalWarning" || !warning.message.includes("SQLite")) {
      for (const listener of previousListeners) listener.call(process, warning);
    }
  };
  process.removeAllListeners("warning");
  process.on("warning", suppressExperimentalSqliteWarning);
  try {
    const database = new DatabaseSync(databaseAbsolutePath);
    try {
      database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      const mode = database.prepare("PRAGMA journal_mode=DELETE").get();
      const journalMode = mode && typeof mode.journal_mode === "string" ? mode.journal_mode.toLowerCase() : "";
      if (journalMode !== "delete") {
        throw new Error(`failed to convert code evidence index to DELETE journal mode (got "${journalMode}")`);
      }
    } finally {
      database.close();
    }
  } finally {
    process.removeAllListeners("warning");
    for (const listener of previousListeners) process.on("warning", listener);
  }
  for (const sidecar of [`${databaseAbsolutePath}-wal`, `${databaseAbsolutePath}-shm`]) {
    if (fs.existsSync(sidecar)) fs.rmSync(sidecar);
  }
}

// Install the built Project Librarian CLI into the with-condition fixture so an
// agent can query the code-evidence index offline. dist/init-project-wiki.js
// imports sibling dist modules at runtime, so the entire dist/ tree is copied.
function installLocalRunner(root, cliPath) {
  const distDir = path.dirname(cliPath);
  if (!fs.existsSync(distDir) || !fs.statSync(distDir).isDirectory()) {
    throw new Error(`missing built CLI directory for local runner install: ${distDir}`);
  }
  const runnerDir = path.join(root, "tools", "project-librarian");
  const targetDir = path.join(runnerDir, "dist");
  fs.mkdirSync(targetDir, { recursive: true });
  fs.cpSync(distDir, targetDir, { recursive: true });
  // The built CLI is CommonJS, but the fixture root package.json sets
  // "type": "module". Node resolves a .js file's module type from the nearest
  // package.json, so without a CommonJS marker beside the installed runner Node
  // would treat dist/*.js as ESM and fail with "exports is not defined". Write a
  // local package.json so the installed runner always loads as CommonJS.
  writeFile(path.join(runnerDir, "package.json"), `${JSON.stringify({
    name: "project-librarian-local-runner",
    private: true,
    type: "commonjs",
  }, null, 2)}\n`);

  // dist/code-index.js eagerly requires the third-party "typescript" package
  // (the only non-builtin runtime dependency in dist/). The code-query path does
  // not parse code, but the module-level require still runs, so the dependency
  // must resolve from the installed runner. Symlink the repo's installed package
  // into the runner's node_modules; node_modules is excluded from fixture
  // fingerprints, so this does not perturb provenance.
  installTypescriptDependency(runnerDir);

  const installedCli = path.join(targetDir, path.basename(cliPath));
  if (!fs.existsSync(installedCli)) {
    throw new Error(`local runner install did not produce ${installedCli}`);
  }
  return path.relative(root, installedCli).split(path.sep).join("/");
}

// Resolve the "typescript" package the built CLI depends on and symlink it into
// the runner's node_modules. Throws if typescript is not installed; there is no
// stub fallback because a stub would change indexing behavior silently.
function installTypescriptDependency(runnerDir) {
  let typescriptPackageJson;
  try {
    typescriptPackageJson = require.resolve("typescript/package.json", { paths: [__dirname] });
  } catch (error) {
    throw new Error(`cannot locate the typescript dependency required by the built CLI; run npm install before benchmark:llm: ${error.message}`);
  }
  const typescriptDir = path.dirname(typescriptPackageJson);
  const nodeModulesDir = path.join(runnerDir, "node_modules");
  fs.mkdirSync(nodeModulesDir, { recursive: true });
  const target = path.join(nodeModulesDir, "typescript");
  if (!fs.existsSync(target)) {
    fs.symlinkSync(typescriptDir, target, "dir");
  }
}

function runProjectLibrarian(cliPath, args, cwd) {
  if (!cliPath || !fs.existsSync(cliPath)) {
    throw new Error("missing Project Librarian CLI; run npm run build before benchmark:llm:dry-run");
  }
  return childProcess.execFileSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

// Parse a JSON response from the installed runner. Throws with a descriptive
// message if the output is not valid JSON, so failures are never silent.
function parseRunnerJson(output, label) {
  try {
    return JSON.parse(output);
  } catch (error) {
    throw new Error(`installed runner ${label} did not return valid JSON: ${error.message}; output: ${output.slice(0, 300)}`);
  }
}

// Verify the installed runner can execute all three task-shaped commands and the
// legacy code-query fallback against the freshly built fixture, under the same
// read-only invocation agents use. Hard-fails with a clear message on any error
// or unexpectedly empty result — the fixture must contain the data each command
// needs or the benchmark is measuring an unindexed fixture.
//
// Checks:
//   1. --code-impact <chain-root>: the import chain root is indexed and has at
//      least one importer in matches.imports (the chain is planted).
//   2. --code-report --code-report-section ownership: the ownership section
//      returns at least one owner row (CODEOWNERS + packages/ are scoped).
//   3. --code-report --code-report-section workspace-graph: the workspace-graph
//      section returns at least one internal dependency edge (the spine is
//      planted at every scale with workspaces >= 2).
//   4. --code-query count (legacy fallback): the index has indexed files.
//
// All commands are invoked read-only with the installed CLI so the same
// invocation shape agents use in the sandbox is confirmed to work.
function verifyInstalledRunnerCommands(root, installedCliRelative) {
  const installedCli = path.join(root, installedCliRelative);

  // 1. --code-impact: use the chain root filename as the term. The fixture plants
  // mod-0.ts at packages/workspace-0/src/mod-0.ts; the term "mod-0" matches it
  // by filename substring and the import chain guarantees at least mod-1.ts
  // imports it, so matches.imports must be non-empty.
  const impactOutput = runProjectLibrarian(installedCli, ["--code-impact", "mod-0"], root);
  const impactJson = parseRunnerJson(impactOutput, "--code-impact mod-0");
  const importers = impactJson.matches && Array.isArray(impactJson.matches.imports) ? impactJson.matches.imports : null;
  if (!importers || importers.length === 0) {
    throw new Error(
      `installed runner --code-impact mod-0 returned no importers; the import chain may not be indexed. Output: ${impactOutput.slice(0, 300)}`,
    );
  }

  // 2. --code-report --code-report-section ownership: data must be a non-empty
  // array (at least one owner row — CODEOWNERS is scoped and packages/ are indexed).
  const ownershipOutput = runProjectLibrarian(installedCli, ["--code-report", "--code-report-section", "ownership"], root);
  const ownershipJson = parseRunnerJson(ownershipOutput, "--code-report --code-report-section ownership");
  if (!Array.isArray(ownershipJson.data) || ownershipJson.data.length === 0) {
    throw new Error(
      `installed runner --code-report --code-report-section ownership returned no owner rows; CODEOWNERS or packages/ may not be indexed. Output: ${ownershipOutput.slice(0, 300)}`,
    );
  }

  // 3. --code-report --code-report-section workspace-graph: internal_dependencies
  // must be non-empty (the spine plants workspace-K -> workspace-(K-1) edges;
  // scales with workspaces >= 2 always have at least one internal dep edge).
  const wsGraphOutput = runProjectLibrarian(installedCli, ["--code-report", "--code-report-section", "workspace-graph"], root);
  const wsGraphJson = parseRunnerJson(wsGraphOutput, "--code-report --code-report-section workspace-graph");
  const internalDeps = wsGraphJson.data && Array.isArray(wsGraphJson.data.internal_dependencies) ? wsGraphJson.data.internal_dependencies : null;
  if (!internalDeps || internalDeps.length === 0) {
    throw new Error(
      `installed runner --code-report --code-report-section workspace-graph returned no internal dependency edges; the workspace spine may not be indexed. Output: ${wsGraphOutput.slice(0, 300)}`,
    );
  }

  // 4. --code-query count (legacy fallback path): confirms the SQL interface
  // still works for agents that reach for it despite the pointer's task-first advice.
  const queryOutput = runProjectLibrarian(installedCli, ["--code-query", "SELECT count(*) AS files FROM files"], root);
  const queryRows = parseRunnerJson(queryOutput, "--code-query count");
  if (!Array.isArray(queryRows) || queryRows.length !== 1 || !Number.isFinite(queryRows[0].files) || queryRows[0].files <= 0) {
    throw new Error(`installed runner --code-query returned no indexed files: ${queryOutput.slice(0, 200)}`);
  }
}

// A1: the with-condition fixture is a MAINTAINED wiki, not a bootstrap-default
// one. The seeded decision is a single dated entry that must appear consistently
// in the decision log, in decisions/recent.md, and in startup.md Recent
// Decisions; the router-truth consistency assert below enforces that none of
// them still say "None yet." while the log holds this entry. The date string is
// fixed (no Date.now()) so fixture content and expectations stay deterministic.
const SEEDED_DECISION = {
  date: "2026-06-10",
  category: "metrics",
  summary: "actual LLM benchmark comparison adopted",
};

const NONE_YET_MARKER = "None yet.";

// A3 aggregation ground truth. A fixed, deterministic set of dated decisions that
// is planted ONE-PER-PAGE across multiple planning pages in every condition and
// profile. The aggregation question ("list every dated decision in chronological
// order") is answerable only by synthesizing across these scattered pages: the
// full ordered list appears on no single page (enforced by the build-time
// no-single-page-aggregate assert). Dates are fixed strings (no Date.now()) and
// already in chronological order here; the chronological-order ground truth is
// just this declared order. These dates are distinct from SEEDED_DECISION's
// 2026-06-10 and from the organic distractors so the aggregation set is its own
// inventory and "every dated decision" includes the seeded answer date too.
const AGGREGATION_DECISIONS = [
  { date: "2026-01-15", summary: "initialize the project planning wiki" },
  { date: "2026-02-09", summary: "adopt the compact session-start routing model" },
  { date: "2026-03-22", summary: "split canonical docs from decision logs" },
  { date: "2026-05-04", summary: "require correctness checks on benchmark runs" },
];

// The full chronological ground-truth inventory the aggregation answer must list:
// the per-scale-independent AGGREGATION_DECISIONS plus the seeded answer decision,
// in ascending date order. Computed deterministically (sorted by date string,
// which is ISO so lexical order equals chronological order). This is the same for
// every control profile because the same dated facts are planted in each; the
// profile only changes WHERE each fact lives, not the set.
function aggregationGroundTruth() {
  const all = [...AGGREGATION_DECISIONS, { date: SEEDED_DECISION.date, summary: SEEDED_DECISION.summary }];
  return [...all].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// The aggregation correctness expectation embedded in the manifest per scenario.
// Mirrors the static/code_graph expectation shape consumed by llm-correctness.js:
//   - required_terms: every date in the inventory must appear in the final text.
//   - any_terms:      at least one decision-ish word, so a bare date dump without
//                     framing still reads as a decision list.
//   - forbidden_terms: the standard refusal sentinel.
//   - aggregate_components: the ordered [date, summary] inventory, recorded so a
//     human auditor (and the no-single-page assert) can see the exact ground truth.
//   - no_single_page_terms: the term set whose full co-occurrence on any single
//     Markdown page is forbidden (the dated summaries); the build-time assert
//     fails if every one of these appears together in one file.
// Order tolerance: correctness requires all dates present but does NOT enforce
// textual ordering, because Codex final text rarely preserves an exact ordering
// and the required synthesis (gathering all dates from scattered pages) is what
// the task measures; this tolerance is documented here and in benchmarks/README.md.
function aggregationExpectation() {
  const inventory = aggregationGroundTruth();
  return {
    required_terms: inventory.map((decision) => decision.date),
    any_terms: [["decision", "decisions", "chronological", "dated"]],
    forbidden_terms: ["I cannot access"],
    aggregate_components: inventory.map((decision) => ({ date: decision.date, summary: decision.summary })),
    no_single_page_terms: inventory.map((decision) => decision.summary),
    // Profile-aware evidence (consistent with Phase 1's wiki-family design): the
    // dated-decision pages live at deterministic paths per condition/profile. The
    // with-condition pages are under wiki/canonical/; the control pages are under
    // the profile's docs history directory (curated: docs/decisions-history/,
    // organic+bare: docs/history/). evaluateCorrectness treats this as a wiki-track
    // evidence map (not code-graph) because aggregation is benchmark_track: wiki.
    evidence_by_condition: {
      with_project_librarian: [["wiki/canonical/dated-decision-0.md", "wiki/canonical/dated-decision-1.md", "wiki/canonical/dated-decision-2.md", "wiki/canonical/dated-decision-3.md", "wiki/decisions/log.md"]],
      without_project_librarian: {
        curated: [["docs/decisions-history/dated-decision-0.md", "docs/decisions.md"]],
        organic: [["docs/history/dated-decision-0.md", "docs/notes/decision-log.md"]],
        bare: [["docs/history/dated-decision-0.md", "docs/NOTES.md"]],
      },
    },
  };
}

// One Markdown body per aggregation decision, used to plant the dated facts
// one-per-page. The page states a single dated decision plus filler, never the
// full inventory, so synthesis across pages is required.
function aggregationDecisionPage(decision, index, scaleName) {
  return `---
status: active
updated: 2026-06-10
scope: benchmark-fixture
read_budget: short
decision_ref: none
review_trigger: benchmark fixture regeneration
---

# Dated Decision ${index} (${scaleName})

On ${decision.date} the project decided to ${decision.summary}.

This page records exactly one dated decision. The full decision history is spread
across the other dated-decision pages; consult each to reconstruct the timeline.
`;
}

function seededDecisionLogLine() {
  return `- ${SEEDED_DECISION.date} | ${SEEDED_DECISION.category} | ${SEEDED_DECISION.summary}.`;
}

function seededDecisionLog() {
  return `# Decision Log\n\n${seededDecisionLogLine()}\n`;
}

// decisions/recent.md keeps the bootstrap structure but plants the seeded
// decision in the Decisions section instead of the template's "None yet." line
// (the measured router-truth contradiction was recent.md/startup.md saying
// "None yet." while the log held the answer).
function maintainedRecentDecisions() {
  return `---
status: active
updated: 2026-06-10
scope: project-decisions
read_budget: short
decision_ref: wiki/meta/decision-policy.md
review_trigger: recent important project decisions change
---
# Recent Decisions

## TL;DR

- Keep only recent important project decisions that may matter at session start.
- Use [[decisions/log]] for full timestamp tracking.

## Decisions

- ${SEEDED_DECISION.date}: ${SEEDED_DECISION.summary}. See [[decisions/log]] and [[canonical/benchmark-and-release-evidence]].
`;
}

// Maintained startup.md: standard frontmatter and section structure, but the
// Project State carries the fixture project framing and Recent Project Decisions
// carries the seeded dated decision (never "None yet."). Kept compact to stay
// within the session-hook startup budget (src/hooks.ts: 3500 chars). Code topics
// are intentionally generic: no CODEOWNERS owner handle and no workspace package
// name, so the docs-only answerability gate does not trip on this router text.
function maintainedStartup() {
  return `---
status: active
updated: 2026-06-10
scope: startup-router
read_budget: short
decision_ref: wiki/meta/wiki-ops-v1-decisions.md
review_trigger: session-start summary, routing, language policy, or open project state changes
---
# Startup Context

## TL;DR

- This project is a maintained benchmark-evidence fixture: project truth lives in \`wiki/canonical/\`, decision history in \`wiki/decisions/\`.
- At session start, read only this file and \`wiki/index.md\` first; read detailed files on demand via the index "read when" routes.
- Update the wiki in the same turn when project-planning content changes.

## Read On Demand

- [[index]]: document router with read-when hints for every answer page.
- [[canonical/benchmark-and-release-evidence]]: benchmark evidence policy and the latest evidence decision.
- [[canonical/project-brief]]: project direction, audience, scope, and current risks.

## Project State

- Problem/opportunity: validate coding-agent onboarding, risks, and where to read next from a maintained wiki.
- Core scenario: with-vs-without Project Librarian comparison on generated fixtures.
- Current risks: route drift, benchmark overclaiming, and stale code evidence.
- Project content language: English.

## Recent Project Decisions

- ${SEEDED_DECISION.date}: ${SEEDED_DECISION.summary}. Source: [[decisions/log]] and [[canonical/benchmark-and-release-evidence]].

## Wiki Operating Pointers

- Decision recording follows [[meta/decision-policy]].
- Wiki operation follows [[meta/operating-model]].

## Token Discipline

- Session-start hooks inject only this file and \`wiki/index.md\`; detailed files are selected by the index "read when" rules.
`;
}

// A1 hand-routed answer pages: each wiki-track family's expected evidence page is
// linked from a hand-written "Answer Routes" section in wiki/index.md with a
// one-line read-when hint, so startup -> index -> answer page is reachable within
// two hops. After this maintained index is written, --refresh-index appends only
// the auto-discovered filler pages between the AUTO-INDEX markers, leaving these
// hand-written routes intact. Descriptions stay generic about code topics so the
// docs-only answerability gate does not trip. Order is fixed (deterministic).
const ANSWER_PAGE_ROUTES = [
  {
    page: "canonical/benchmark-and-release-evidence.md",
    readWhen: "benchmark evidence policy, the latest evidence decision, or claim gates matter.",
  },
  {
    page: "canonical/code-impact.md",
    readWhen: "which files a benchmark report schema change is likely to impact matter.",
  },
  {
    page: "canonical/implementation-map.md",
    readWhen: "where to edit to implement the Codex LLM benchmark runner matters.",
  },
  {
    page: "canonical/release-policy.md",
    readWhen: "the checks required before publishing or making benchmark claims matter.",
  },
  {
    page: "canonical/project-brief.md",
    readWhen: "project direction, audience, scope, success criteria, or current risks matter.",
  },
  {
    page: "canonical/dated-decision-0.md",
    readWhen: "a chronological inventory of every dated project decision matters; exclude wiki operating/meta decisions unless explicitly requested.",
  },
  {
    page: "canonical/dated-decision-1.md",
    readWhen: "a chronological inventory of every dated project decision matters; exclude wiki operating/meta decisions unless explicitly requested.",
  },
  {
    page: "canonical/dated-decision-2.md",
    readWhen: "a chronological inventory of every dated project decision matters; exclude wiki operating/meta decisions unless explicitly requested.",
  },
  {
    page: "canonical/dated-decision-3.md",
    readWhen: "a chronological inventory of every dated project decision matters; exclude wiki operating/meta decisions unless explicitly requested.",
  },
];

function wikiLinkTargetForPage(page) {
  return page.replace(/\.md$/, "");
}

// Maintained wiki/index.md: hand-written router with a Language/Boundary policy,
// a Startup pointer, the hand-routed Answer Routes for the wiki-track answer
// pages, and the empty AUTO-INDEX block that --refresh-index later fills with the
// auto-discovered filler pages (or scoped routers when over threshold). Kept
// compact so the hand-written portion plus the auto-block stays within the
// session-hook index budget (src/hooks.ts: 4500 chars).
function maintainedIndex() {
  const answerRoutes = ANSWER_PAGE_ROUTES
    .map((route) => `- [[${wikiLinkTargetForPage(route.page)}]]\n  - Read when ${route.readWhen}`)
    .join("\n");
  return `---
status: active
updated: 2026-06-10
scope: wiki-router
read_budget: short
decision_ref: wiki/meta/wiki-ops-v1-decisions.md
review_trigger: wiki page added, moved, removed, or routing changes
---
# Wiki Index

## How To Use This Index

This file is a router, not a file to expand into every answer. Read only the files relevant to the current question, following the "read when" hints.

## Boundary Rule

- \`wiki/canonical/\` and \`wiki/decisions/\` contain project-planning content only.
- Wiki operating rules and decisions live in \`wiki/meta/\`.
- For project decision inventories, stay in \`wiki/canonical/\` and \`wiki/decisions/\`; read \`wiki/meta/\` only when wiki operation or metadata is explicitly requested.

## Startup

- [[startup]]
  - Read when: every session start or compact project-state lookup.

## Answer Routes

${answerRoutes}

## Project Decisions

- [[decisions/recent]]
  - Read when: recent important project decisions matter.
- [[decisions/log]]
  - Read when: project decision timing matters.

<!-- PROJECT-WIKI-AUTO-INDEX:START -->
<!-- PROJECT-WIKI-AUTO-INDEX:END -->
`;
}

// Router-truth consistency assert (A1, throws on violation, no fallback): if the
// fixture decision log holds a dated entry, then startup.md Recent Decisions and
// decisions/recent.md must not say "None yet." and must contain the seeded
// decision's date string. Deterministic string checks only.
function assertRouterTruthConsistency(root) {
  const logPath = path.join(root, "wiki", "decisions", "log.md");
  if (!fs.existsSync(logPath)) {
    throw new Error(`router-truth consistency assert: missing decision log ${logPath}`);
  }
  const logText = fs.readFileSync(logPath, "utf8");
  const datedEntry = /\b\d{4}-\d{2}-\d{2}\b/.test(logText);
  if (!datedEntry) return;
  const dateString = SEEDED_DECISION.date;
  for (const relative of ["wiki/startup.md", "wiki/decisions/recent.md"]) {
    const filePath = path.join(root, relative);
    if (!fs.existsSync(filePath)) {
      throw new Error(`router-truth consistency assert: missing maintained router file ${relative}`);
    }
    const text = fs.readFileSync(filePath, "utf8");
    if (text.includes(NONE_YET_MARKER)) {
      throw new Error(`router-truth consistency assert failed: ${relative} still says "${NONE_YET_MARKER}" while wiki/decisions/log.md holds a dated entry`);
    }
    if (!text.includes(dateString)) {
      throw new Error(`router-truth consistency assert failed: ${relative} does not contain the seeded decision date ${dateString} from wiki/decisions/log.md`);
    }
  }
}

// Bounded answer reachability assert (A1, throws on violation, no fallback): for
// each wiki-track family's expected evidence page, wiki/index.md must link it so
// startup -> index -> answer page is reachable within two hops. Deterministic
// string checks: startup links the index, and the index links each answer page.
function assertBoundedAnswerReachability(root) {
  const startupPath = path.join(root, "wiki", "startup.md");
  const indexPath = path.join(root, "wiki", "index.md");
  for (const [relative, filePath] of [["wiki/startup.md", startupPath], ["wiki/index.md", indexPath]]) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`bounded reachability assert: missing maintained router file ${relative}`);
    }
  }
  const startupText = fs.readFileSync(startupPath, "utf8");
  if (!startupText.includes("[[index]]")) {
    throw new Error(`bounded reachability assert failed: wiki/startup.md does not link [[index]] (hop 1 broken)`);
  }
  const indexText = fs.readFileSync(indexPath, "utf8");
  for (const route of ANSWER_PAGE_ROUTES) {
    const link = `[[${wikiLinkTargetForPage(route.page)}]]`;
    if (!indexText.includes(link)) {
      throw new Error(`bounded reachability assert failed: wiki/index.md does not route the answer page ${route.page} as ${link} (hop 2 broken)`);
    }
  }
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
  writeFile(path.join(root, "wiki", "decisions", "log.md"), seededDecisionLog());

  // A3 aggregation: plant the dated-decision inventory ONE-PER-PAGE so the full
  // chronological list lives on no single page (the answer requires synthesizing
  // across them). log.md deliberately keeps only the seeded decision so the
  // no-single-page-aggregate assert holds and the router-truth assert is unaffected.
  for (const [index, decision] of AGGREGATION_DECISIONS.entries()) {
    writeFile(path.join(root, "wiki", "canonical", `dated-decision-${index}.md`), aggregationDecisionPage(decision, index, scaleName));
  }

  // A1: after bootstrap and page planting, overwrite the router state directly so
  // the fixture is a maintained wiki. The product CLI only writes these routers
  // when absent (writeStarter), so these overwrites stick. decisions/recent.md
  // and startup.md carry the seeded decision; index.md hand-routes the answer
  // pages. --refresh-index runs AFTER the maintained index is written so the
  // auto-block reflects reality without clobbering the hand-written routes.
  writeFile(path.join(root, "wiki", "decisions", "recent.md"), maintainedRecentDecisions());
  writeFile(path.join(root, "wiki", "startup.md"), maintainedStartup());
  writeFile(path.join(root, "wiki", "index.md"), maintainedIndex());
  runProjectLibrarian(cliPath, ["--refresh-index"], root);

  // A1 build-time asserts (throw on violation, no fallback), run for every scale:
  // router-truth consistency and bounded answer reachability.
  assertRouterTruthConsistency(root);
  assertBoundedAnswerReachability(root);
}

// A2: control profiles. The control (without Project Librarian) is materialized
// under one of three profiles; the default is organic. All profiles share the
// same base code repo (materializeBaseRepo) and keep every wiki-family answer
// present and findable so correctness stays satisfiable, but they differ in how
// discoverable the answers are:
//   - curated:  idealized per-topic flat docs (today's behavior) — upper bound.
//   - organic:  the same facts scattered across more files with unrelated filler
//               text, plus dated distractor decisions (strictly earlier than the
//               seeded answer date) so "latest decision" requires date compare.
//   - bare:     a single unstructured docs/NOTES.md dump of all facts, no
//               per-topic organization (answers exist but discovery is hardest).
const controlProfiles = ["bare", "organic", "curated"];

// Dated distractor decisions for the organic profile. Dates are strictly earlier
// than SEEDED_DECISION.date (2026-06-10) so the latest decision is still the
// seeded one; finding it requires comparing dates rather than taking the first
// dated line. Fixed dates (no Date.now()) keep fixture content deterministic.
const ORGANIC_DISTRACTOR_DECISIONS = [
  { date: "2026-04-03", summary: "use Markdown character estimates for benchmark sizing" },
  { date: "2026-05-12", summary: "track tool-call counts alongside token usage" },
];

// Deterministic unrelated filler paragraph for the organic profile; seeded by an
// integer so content is stable across runs. No randomness, no timestamps.
function organicFiller(seed) {
  const topics = [
    "Sprint logistics and on-call rotation notes are tracked in the team handbook.",
    "Local development setup uses the standard package manager and the shared lint config.",
    "Meeting notes and retro action items are archived per quarter for reference.",
    "The design system tokens and component inventory live in a separate workspace.",
    "Release scheduling and changelog hygiene are reviewed in the weekly sync.",
  ];
  return topics[seed % topics.length];
}

// A3 aggregation: plant the dated-decision inventory ONE-PER-PAGE under the given
// docs subdirectory of a control fixture. Used by every control profile (including
// bare) so the aggregation facts are present in each layout but the full ordered
// list still lives on no single page — the no-single-page-aggregate assert holds
// in every condition. The subdir differs per profile only to match that profile's
// directory style; the per-page split is identical.
function plantAggregationDecisionPages(root, scaleName, subdir) {
  for (const [index, decision] of AGGREGATION_DECISIONS.entries()) {
    writeFile(path.join(root, ...subdir, `dated-decision-${index}.md`), aggregationDecisionPage(decision, index, scaleName));
  }
}

function materializeControlCurated(root, scaleName) {
  const scale = scales[scaleName];
  writeFile(path.join(root, "docs", "project-overview.md"), "# Project Overview\n\nThis benchmark fixture validates coding-agent onboarding, risks, and where to read next. Current risks include route drift, benchmark overclaiming, and stale code evidence. Read README.md, docs/benchmark-policy.md, and docs/release-policy.md next.\n");
  writeFile(path.join(root, "docs", "benchmark-policy.md"), "# Benchmark Policy\n\nActual LLM evidence compares tools by measured token usage, wall-clock time, command/tool-call counts, full matrix coverage, claimable runs, and correctness checks.\n");
  writeFile(path.join(root, "docs", "release-policy.md"), "# Release Policy\n\nBefore publishing benchmark claims, run the full matrix with --full-matrix, require claimable output, validate raw JSONL with tests/validators/codex-llm-benchmark-smoke.js, and include Markdown plus JSON evidence.\n");
  writeFile(path.join(root, "docs", "code-impact.md"), "# Code Impact\n\nBenchmark report schema changes impact benchmarks/codex-llm-metrics.js, benchmarks/lib/codex-jsonl.js, benchmarks/lib/llm-report.js, benchmarks/lib/llm-correctness.js, and tests/validators/codex-llm-benchmark-smoke.js.\n");
  writeFile(path.join(root, "docs", "implementation-map.md"), "# Implementation Map\n\nEdit benchmarks/codex-llm-metrics.js for the Codex LLM benchmark runner, benchmarks/lib/llm-report.js for aggregation, and tests/validators/codex-llm-benchmark-smoke.js for validation.\n");
  writeFile(path.join(root, "docs", "decisions.md"), "# Decisions\n\n- 2026-06-10: actual LLM benchmark comparison adopted.\n");
  for (let index = 0; index < scale.wikiPages; index += 1) {
    writeFile(path.join(root, "docs", "planning", `fixture-page-${index}.md`), planningPage(index, scaleName));
  }
  plantAggregationDecisionPages(root, scaleName, ["docs", "decisions-history"]);
}

function materializeControlOrganic(root, scaleName) {
  const scale = scales[scaleName];
  // Onboarding facts buried inside an engineering handbook among filler.
  writeFile(path.join(root, "docs", "handbook", "engineering.md"), `# Engineering Handbook

${organicFiller(0)}

## Onboarding

This benchmark fixture validates coding-agent onboarding, risks, and where to read next. Current risks include route drift, benchmark overclaiming, and stale code evidence. New contributors usually start from README.md and the operations notes.

${organicFiller(1)}
`);
  // Benchmark policy facts split between an operations note and a QA note.
  writeFile(path.join(root, "docs", "handbook", "operations.md"), `# Operations Notes

${organicFiller(2)}

Actual LLM evidence compares tools by measured token usage and wall-clock time. ${organicFiller(3)}
`);
  writeFile(path.join(root, "docs", "qa", "measurement.md"), `# QA Measurement Notes

${organicFiller(4)}

Benchmark comparison also tracks command and tool-call counts, full matrix coverage, claimable runs, and correctness checks. ${organicFiller(0)}
`);
  // Release policy facts inside a wiki-style runbook page among filler.
  writeFile(path.join(root, "docs", "runbooks", "release.md"), `# Release Runbook

${organicFiller(1)}

Before publishing benchmark claims, run the full matrix with --full-matrix, require claimable output, validate raw JSONL with tests/validators/codex-llm-benchmark-smoke.js, and include Markdown plus JSON evidence.

${organicFiller(2)}
`);
  // Code-impact facts inside an architecture note among filler.
  writeFile(path.join(root, "docs", "architecture", "modules.md"), `# Module Map

${organicFiller(3)}

Benchmark report schema changes impact benchmarks/codex-llm-metrics.js, benchmarks/lib/codex-jsonl.js, benchmarks/lib/llm-report.js, benchmarks/lib/llm-correctness.js, and tests/validators/codex-llm-benchmark-smoke.js.

To implement the Codex LLM benchmark runner, edit benchmarks/codex-llm-metrics.js, benchmarks/lib/llm-report.js for aggregation, and tests/validators/codex-llm-benchmark-smoke.js for validation.

${organicFiller(4)}
`);
  // Dated decisions: distractors first (earlier dates), seeded answer last, so a
  // correct "latest decision" answer requires comparing the dates rather than
  // taking the first or last dated line by position.
  const decisionLines = [
    ...ORGANIC_DISTRACTOR_DECISIONS.map((decision) => `- ${decision.date}: ${decision.summary}.`),
    `- ${SEEDED_DECISION.date}: ${SEEDED_DECISION.summary}.`,
  ];
  writeFile(path.join(root, "docs", "notes", "decision-log.md"), `# Decision Log

${organicFiller(0)}

Decisions are recorded here over time, newest entries are not guaranteed to be last:

${decisionLines.join("\n")}

${organicFiller(1)}
`);
  for (let index = 0; index < scale.wikiPages; index += 1) {
    writeFile(path.join(root, "docs", "scattered", `note-${index}.md`), `# Note ${index}

${organicFiller(index)}

${planningPage(index, scaleName)}`);
  }
  plantAggregationDecisionPages(root, scaleName, ["docs", "history"]);
}

function materializeControlBare(root, scaleName) {
  const scale = scales[scaleName];
  // Single unstructured dump of every fact with no per-topic organization. The
  // seeded decision and the distractor-free single date both appear here; the
  // answers exist but discovery is hardest because there is no routing.
  const fillerLines = [];
  for (let index = 0; index < scale.wikiPages; index += 1) {
    fillerLines.push(`Fixture fact ${index} for ${scaleName}: owner benchmark-team-${index % 5}, risk route drift ${index}, verification npm run benchmark:llm:dry-run. ${organicFiller(index)}`);
  }
  writeFile(path.join(root, "docs", "NOTES.md"), `# Notes

This benchmark fixture validates coding-agent onboarding, risks, and where to read next. Current risks include route drift, benchmark overclaiming, and stale code evidence.

Actual LLM evidence compares tools by measured token usage, wall-clock time, command and tool-call counts, full matrix coverage, claimable runs, and correctness checks.

Before publishing benchmark claims, run the full matrix with --full-matrix, require claimable output, validate raw JSONL with tests/validators/codex-llm-benchmark-smoke.js, and include Markdown plus JSON evidence.

Benchmark report schema changes impact benchmarks/codex-llm-metrics.js, benchmarks/lib/codex-jsonl.js, benchmarks/lib/llm-report.js, benchmarks/lib/llm-correctness.js, and tests/validators/codex-llm-benchmark-smoke.js.

To implement the Codex LLM benchmark runner, edit benchmarks/codex-llm-metrics.js, benchmarks/lib/llm-report.js for aggregation, and tests/validators/codex-llm-benchmark-smoke.js for validation.

Decision ${SEEDED_DECISION.date}: ${SEEDED_DECISION.summary}.

${fillerLines.join("\n")}
`);
  // Even in the bare profile the aggregation inventory stays one-per-page so the
  // full ordered list is on no single page; only the rest of the docs is dumped.
  plantAggregationDecisionPages(root, scaleName, ["docs", "history"]);
}

function materializeWithoutProjectLibrarian(root, scaleName, controlProfile = "organic") {
  if (!controlProfiles.includes(controlProfile)) {
    throw new Error(`unknown control profile: ${controlProfile}`);
  }
  materializeBaseRepo(root, scaleName, "without_project_librarian");
  if (controlProfile === "curated") {
    materializeControlCurated(root, scaleName);
  } else if (controlProfile === "organic") {
    materializeControlOrganic(root, scaleName);
  } else {
    materializeControlBare(root, scaleName);
  }
}

// Frame a single prompt body with the standard benchmark-scenario preamble. The
// optional sessionLabel marks a multi_session session ("session 1 of 2" etc.) so
// each session prompt is self-describing; the per-session codex execs are
// independent (separate ephemeral CODEX_HOME), so the label is informational only.
function framePrompt(promptBody, scale, condition, taskFamily, sessionLabel = "") {
  const header = sessionLabel
    ? `Benchmark scenario: ${scale} / ${condition} / ${taskFamily} (${sessionLabel}).`
    : `Benchmark scenario: ${scale} / ${condition} / ${taskFamily}.`;
  return [
    header,
    "Work as a coding agent in this repository.",
    "Use only local repository evidence.",
    "Do not modify files unless explicitly asked.",
    promptBody,
  ].join("\n");
}

function promptFor(taskFamily, scale, condition) {
  const prompt = taskFamilies[taskFamily];
  if (!prompt) throw new Error(`unknown task family: ${taskFamily}`);
  return framePrompt(prompt, scale, condition, taskFamily);
}

function codexCommand(prompt, requestedModel = "") {
  const command = ["codex", "exec", "--json", "--ephemeral", "--sandbox", "read-only", "--skip-git-repo-check"];
  if (requestedModel) command.push("--model", requestedModel);
  command.push(prompt);
  return command;
}

// Build the per-session list for a multi_session scenario. Two sequential codex
// execs in the SAME fixture cwd, each with its own command:
//   session 1 (familiarization): an onboarding-style pass, only needs completion.
//   session 2 (measured):        the decision/policy lookup; its metrics are the
//                                 scenario's primary metrics and its final text is
//                                 what correctness evaluates.
// The role field lets the runner know which session is measured without positional
// assumptions; session_index is 1-based and matches execution order.
function multiSessionSessions(scale, condition, requestedModel) {
  const definition = taskFamilyDefinitions.multi_session;
  const familiarizationPrompt = framePrompt(definition.multi_session.familiarization_prompt, scale, condition, "multi_session", "session 1 of 2: familiarization");
  const measuredPrompt = framePrompt(definition.prompt, scale, condition, "multi_session", "session 2 of 2: measured");
  return [
    {
      session_index: 1,
      role: "familiarization",
      prompt: familiarizationPrompt,
      command: codexCommand(familiarizationPrompt, requestedModel),
    },
    {
      session_index: 2,
      role: "measured",
      prompt: measuredPrompt,
      command: codexCommand(measuredPrompt, requestedModel),
    },
  ];
}

function buildScenarioManifest({ fixtureRoot, scale, condition, taskFamily, requestedModel = "", controlProfile = "organic" }) {
  const cwd = path.join(fixtureRoot, scale, condition);
  const benchmarkTrack = trackForTaskFamily(taskFamily);
  // Expectation sourcing (synthetic matrix is wiki-only):
  //   - aggregation: deterministic ground-truth inventory (scale-independent set,
  //     scattered one-per-page); validator recomputes from raw JSONL + this.
  //   - other wiki families (incl. multi_session): static expectations map in
  //     llm-correctness.js keyed by task_family; carry expectation: null.
  let expectation = null;
  if (taskFamily === "aggregation") {
    expectation = aggregationExpectation();
  }

  const base = {
    scale,
    condition,
    benchmark_track: benchmarkTrack,
    // Corpus dimension: synthetic fixtures carry corpus "synthetic" and null
    // repo/question fields. The real-repository track (benchmarks/lib/real-corpus.js)
    // produces corpus "real" scenarios with repo/repo_sha/question_id populated;
    // reports separate the two corpora and never merge their numbers.
    corpus: "synthetic",
    repo: null,
    repo_sha: null,
    question_id: null,
    task_family: taskFamily,
    // The control profile only shapes the without_project_librarian fixture, but
    // it is recorded on every scenario so the pair shares one labeled profile and
    // reports/validators can group and scope claims by profile.
    control_profile: controlProfile,
    prompt_id: `${taskFamily}-${scale}-${condition}`,
    cwd,
    expectation,
    requested_model: requestedModel || null,
    fixture_fingerprint: fingerprintDirectory(cwd),
  };

  if (taskFamily === "multi_session") {
    // multi_session carries a sessions array (two prompts/commands). The top-level
    // prompt/command mirror the MEASURED session (session 2) so single-prompt code
    // paths (report scenario.prompt, manifest fingerprint, correctness static map)
    // resolve the measured question. session_count records the sequence length.
    const sessions = multiSessionSessions(scale, condition, requestedModel);
    const measured = sessions.find((session) => session.role === "measured");
    return {
      ...base,
      prompt: measured.prompt,
      command: measured.command,
      sessions,
      session_count: sessions.length,
    };
  }

  const prompt = promptFor(taskFamily, scale, condition);
  return {
    ...base,
    prompt,
    command: codexCommand(prompt, requestedModel),
  };
}

function materializeFixturePair(fixtureRoot, scale, cliPath, controlProfile = "organic") {
  const withRoot = path.join(fixtureRoot, scale, "with_project_librarian");
  const withoutRoot = path.join(fixtureRoot, scale, "without_project_librarian");
  materializeWithProjectLibrarian(withRoot, scale, cliPath);
  materializeWithoutProjectLibrarian(withoutRoot, scale, controlProfile);

  // A3 no-single-page-aggregate gate: the aggregation answer must require
  // synthesizing facts scattered across multiple pages, so no single Markdown page
  // in either condition may carry the full dated-decision inventory. The gate runs
  // TWICE per condition — once for the prose-summary term set (no_single_page_terms)
  // and once for the date-string term set (required_terms) — so BOTH violation shapes
  // are caught: a history page that lists all prose summaries, and a history page that
  // enumerates all dates (the most common violation shape, ~4/5 triggers). The
  // individual dated facts are planted one-per-page above; this asserts the invariant
  // in both conditions. Always run (the aggregation pages are always planted).
  const aggExpectation = aggregationExpectation();
  assertNoSinglePageAggregate(withRoot, aggExpectation.no_single_page_terms);
  assertNoSinglePageAggregate(withRoot, aggExpectation.required_terms);
  assertNoSinglePageAggregate(withoutRoot, aggExpectation.no_single_page_terms);
  assertNoSinglePageAggregate(withoutRoot, aggExpectation.required_terms);
}

function buildManifest({ fixtureRoot, cliPath, selectedScales = Object.keys(scales), selectedTasks = Object.keys(taskFamilies), requestedModel = "", controlProfile = "organic" }) {
  if (!controlProfiles.includes(controlProfile)) {
    throw new Error(`unknown control profile: ${controlProfile}`);
  }
  const scenarios = [];
  for (const scale of selectedScales) {
    materializeFixturePair(fixtureRoot, scale, cliPath, controlProfile);
    for (const condition of conditions) {
      for (const taskFamily of selectedTasks) {
        scenarios.push(buildScenarioManifest({ fixtureRoot, scale, condition, taskFamily, requestedModel, controlProfile }));
      }
    }
  }

  const taskTracksForSelected = Object.fromEntries(
    selectedTasks.map((taskFamily) => [taskFamily, trackForTaskFamily(taskFamily)]),
  );
  const presentTracks = benchmarkTracks.filter((track) => Object.values(taskTracksForSelected).includes(track));

  return {
    // schema_version 5 adds the corpus dimension: every scenario carries
    // `corpus` ("synthetic" for these synthetic fixtures) plus null
    // `repo`/`repo_sha`/`question_id`, and corpus is folded into the manifest
    // fingerprint. The real-repository track emits corpus "real" scenarios with
    // those fields populated. schema_version 4 (A3) added the multi_session
    // `sessions`/`session_count` fields and the aggregation `expectation`;
    // `sessions` is folded into the manifest fingerprint. schema_version 3 added
    // control_profile (A2) to the manifest top level and to every scenario.
    schema_version: 5,
    benchmark_kind: "codex-actual-llm-manifest",
    generated_at: new Date().toISOString(),
    fixture_root: fixtureRoot,
    scales: selectedScales,
    conditions,
    benchmark_tracks: presentTracks,
    // These synthetic fixtures are the synthetic corpus; the real-repository track
    // builds its own manifest with corpus "real".
    corpus: "synthetic",
    control_profile: controlProfile,
    task_families: selectedTasks,
    task_tracks: taskTracksForSelected,
    requested_model: requestedModel || null,
    manifest_fingerprint: sha256(JSON.stringify(scenarios.map((scenario) => ({
      scale: scenario.scale,
      condition: scenario.condition,
      benchmark_track: scenario.benchmark_track,
      corpus: scenario.corpus,
      repo: scenario.repo,
      repo_sha: scenario.repo_sha,
      question_id: scenario.question_id,
      control_profile: scenario.control_profile,
      task_family: scenario.task_family,
      prompt: scenario.prompt,
      sessions: scenario.sessions || null,
      expectation: scenario.expectation,
      fixture_fingerprint: scenario.fixture_fingerprint,
      requested_model: scenario.requested_model,
    })))),
    scenarios,
  };
}

module.exports = {
  AGGREGATION_DECISIONS,
  ANSWER_PAGE_ROUTES,
  SEEDED_DECISION,
  aggregationExpectation,
  aggregationGroundTruth,
  assertBoundedAnswerReachability,
  assertNoSinglePageAggregate,
  assertRouterTruthConsistency,
  benchmarkTracks,
  buildManifest,
  conditions,
  controlProfiles,
  convertCodeIndexForReadOnlyQuery,
  codeEvidenceRelativeDatabasePath,
  fingerprintDirectory,
  installLocalRunner,
  maintainedIndex,
  maintainedRecentDecisions,
  maintainedStartup,
  materializeFixturePair,
  scales,
  taskFamilies,
  taskFamilyDefinitions,
  taskTracks,
  trackForTaskFamily,
  verifyInstalledRunnerCommands,
};
