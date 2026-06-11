"use strict";

const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");

// A7: each scale carries explicit structural bounds (codeownersRules, importChain,
// minDerivationFiles per code_graph family) so the build-time structural asserts and
// the generators read the same source of truth. The bounds are scale-proportional
// realism targets (encode bounds, never a desired delta):
//   - codeownersRules: minimum CODEOWNERS rule count the generated file must reach
//     (small ~20, medium ~80, large ~250+), including overlapping last-match-wins
//     precedence cases so ownership requires evaluating precedence, not reading a
//     few lines.
//   - importChain: length of the deterministic intra-workspace file import chain
//     planted in workspace-0 (mod-0 <- mod-1 <- ... <- mod-(importChain-1)); the
//     impact_trace transitive importer set is the tail of this chain, so deriving it
//     needs traversal of every chain link and reading every chain file.
//   - minDerivationFiles: the minimum number of DISTINCT files that must be read to
//     derive each code_graph family's expected answer at this scale (>=5 small,
//     >=10 medium, >=20 large). The generators are sized so the actual derivation
//     file set meets or exceeds this, and the build-time assert verifies it.
// workspaces still drives the cross-workspace dependency spine (workspace K imports
// K-1), whose depth is workspaces-1; with these counts that is small 0, medium 4,
// large 11 (so the >=2 at medium / >=3 at large chain-depth bounds hold).
const scales = {
  small: {
    wikiPages: 8,
    codeFiles: 50,
    // A7: small now has 4 workspaces (was 1) so the cross-workspace dependency
    // spine is non-degenerate at every scale — the small workspace_graph answer is
    // a real transitive set (workspace-2, -1, -0) reached by traversal, not the
    // prior trivial "single workspace" answer, and its derivation reads multiple
    // package.json + bridge files. This is the root fix for small-scale ambiguity:
    // every code_graph family now requires genuine traversal at small.
    workspaces: 4,
    codeownersRules: 20,
    importChain: 8,
    serviceFiles: 6,
    minDerivationFiles: 5,
  },
  medium: {
    wikiPages: 80,
    codeFiles: 500,
    // A7: 6 workspaces (was 5) so the workspace_graph transitive set spans the full
    // spine and its derivation (package.json + bridge per hop) clears the medium
    // >=10 distinct-file minimum.
    workspaces: 6,
    codeownersRules: 80,
    importChain: 14,
    serviceFiles: 12,
    minDerivationFiles: 10,
  },
  large: {
    wikiPages: 500,
    codeFiles: 1500,
    workspaces: 12,
    codeownersRules: 250,
    importChain: 24,
    serviceFiles: 22,
    minDerivationFiles: 20,
  },
};

// A7 cross-scale chain-depth bounds for the cross-workspace dependency spine. The
// spine's traversal depth (number of hops to walk the full transitive set) is
// workspaces - 1. These minimums are asserted at build time so a future scale
// change that flattens the graph fails loudly rather than silently making the
// code-graph questions single-hop again.
const MIN_WORKSPACE_CHAIN_DEPTH = { small: 2, medium: 2, large: 3 };

const conditions = ["with_project_librarian", "without_project_librarian"];

const benchmarkTracks = ["wiki", "code_graph"];

// Every task family carries an explicit benchmark_track. The original five stay
// on the wiki track: their answers are planted as doc-lookup sentences in both
// conditions, so they measure document routing, not code evidence. code_impact
// and change_location keep their names and prompts unchanged for comparability
// with the 2026-06-10 report even though they are wiki-track doc lookups.
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
    prompt: "Where should an agent edit to implement a Codex LLM benchmark runner? Do not modify files.",
  },
  // A7: the three code_graph questions require TRAVERSAL of deterministic
  // multi-hop edges, not a single tiny read. Expected answers are computed at
  // generation time (codeGraphExpectation) from the same edges the index records.
  impact_trace: {
    benchmark_track: "code_graph",
    prompt: "Compute the TRANSITIVE impact set of the module packages/workspace-0/src/mod-0.ts: every TypeScript module under packages/workspace-0/src/ that imports it directly OR indirectly (a module that imports a module that imports mod-0, and so on, to any depth). List the relative file paths of every module in that transitive importer set. Answer from code evidence (the import edges), not documentation, and follow the import chain to its full depth rather than reporting only direct importers. Do not modify files.",
  },
  ownership_lookup: {
    benchmark_track: "code_graph",
    prompt: "Using CODEOWNERS last-matching-rule-wins precedence (the LAST rule whose pattern matches a path determines its owner), find the owner of packages/workspace-0/src/service/handler.go and then list EVERY source file under packages/workspace-0/src/service/ that the same owner owns under last-match precedence. Several rules match these paths (a catch-all, an extension rule, the workspace directory, and the src override); report the owner from the rule that wins, not the first or most general match, and enumerate the full owned file set. Answer from code evidence (the CODEOWNERS rules plus the files in that directory), not documentation. Do not modify files.",
  },
  workspace_graph: {
    benchmark_track: "code_graph",
    prompt: "Compute the TRANSITIVE workspace dependency set of the highest-numbered @benchmark/workspace-* package in this monorepo: every @benchmark/workspace-* package it depends on directly OR indirectly through the package.json dependency graph. List those package names. Answer from code evidence (the workspace package.json dependency edges plus the matching import edges), not documentation, and traverse the dependency chain to its full depth. Do not modify files.",
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

// A7 cross-workspace dependency SPINE (replaces the old ring). Workspace K (for
// K >= 1) depends on workspace K-1, forming a straight chain
//   workspace-0 <- workspace-1 <- workspace-2 <- ... <- workspace-(W-1).
// Every dependency edge exists in BOTH a TypeScript bridge file (a real import
// edge in the index) and the workspace package.json `dependencies` map (a config
// edge), and the two agree. Because the chain is a spine, the transitive
// dependency set of the deepest workspace is the entire chain below it, so the
// workspace_graph question cannot be answered without traversing every hop: a
// single grep for the leaf's direct dependency finds only one edge.
function spineDependencyTarget(workspaceIndex) {
  if (workspaceIndex <= 0) return null;
  return workspaceIndex - 1;
}

function internalWorkspaceDependencies(workspaceIndex) {
  const target = spineDependencyTarget(workspaceIndex);
  if (target === null) return {};
  return { [`@benchmark/workspace-${target}`]: "workspace:*" };
}

// The full transitive workspace dependency set of the deepest workspace
// (workspace-(W-1)) under the spine: every lower-indexed workspace package name,
// nearest first. At W <= 1 there is no chain so the set is empty.
function transitiveWorkspaceDependenciesOfLeaf(workspaceCount) {
  if (workspaceCount <= 1) return [];
  const leaf = workspaceCount - 1;
  const set = [];
  for (let k = leaf - 1; k >= 0; k -= 1) set.push(`@benchmark/workspace-${k}`);
  return set;
}

// A7 intra-workspace file import CHAIN, planted in workspace-0/src. mod-K.ts
// imports ./mod-(K-1) for K >= 1, so the modules form a chain
//   mod-0.ts <- mod-1.ts <- ... <- mod-(C-1).ts
// where C === scale.importChain. The transitive importer set of mod-0.ts is the
// whole tail {mod-1 ... mod-(C-1)}; deriving it requires walking every link and
// reading every chain file, which is why impact_trace targets mod-0.ts and why
// the chain length is sized to meet the per-scale distinct-derivation-file bound.
// This chain exists at EVERY scale (including small, W === 1), so impact_trace has
// a concrete, unambiguous, multi-file answer at small and the prior small-scale
// instability (a borderline "no other workspace" answer) is removed at the root.
function fileChainModuleRelativePath(chainIndex) {
  return path.join("packages", "workspace-0", "src", `mod-${chainIndex}.ts`);
}

function fileChainModuleContent(chainIndex) {
  if (chainIndex === 0) {
    return `export function mod0Value() {
  return "workspace-0/mod-0 chain root";
}
`;
  }
  const previous = chainIndex - 1;
  return `import { mod${previous}Value } from "./mod-${previous}";

export function mod${chainIndex}Value() {
  return mod${previous}Value() + " <- mod-${chainIndex}";
}
`;
}

// The transitive importer set of mod-0.ts under the file chain: the tail
// {mod-1 ... mod-(C-1)} as relative file paths, nearest importer first. Deriving
// this set is the impact_trace expected answer.
function transitiveImportersOfChainRoot(chainLength) {
  const set = [];
  for (let chainIndex = 1; chainIndex < chainLength; chainIndex += 1) {
    set.push(fileChainModuleRelativePath(chainIndex).split(path.sep).join("/"));
  }
  return set;
}

// A7 ownership owned-set: the service directory packages/workspace-0/src/service/
// holds a scale-proportional set of source files. Every one is owned by
// @benchmark-service-team because the `/packages/workspace-0/src/service/` rule is
// the LAST CODEOWNERS rule that matches each (the `*`, `*.go`/`*.ts`, workspace dir,
// and src-override rules all also match, but lose under last-match precedence). The
// ownership question asks for the complete owned set, so deriving the answer means
// enumerating every file in this directory AND confirming via CODEOWNERS that the
// service rule wins for each — reading scale.serviceFiles files plus CODEOWNERS.
// The count is sized to the scale's distinct-derivation-file minimum. handler.go
// (chainIndex 0) is the named single-path anchor in the prompt; the remaining files
// extend the owned set. Files alternate .go/.ts so multiple extension rules are in
// play (each still loses to the service rule).
function serviceOwnedFileRelativePath(serviceIndex) {
  const extension = serviceIndex % 2 === 0 ? "go" : "ts";
  const name = serviceIndex === 0 ? "handler" : `handler-${serviceIndex}`;
  return path.join("packages", "workspace-0", "src", "service", `${name}.${extension}`);
}

function serviceOwnedFileContent(serviceIndex) {
  const relative = serviceOwnedFileRelativePath(serviceIndex).split(path.sep).join("/");
  if (relative.endsWith(".go")) {
    return `package service

// Owned via CODEOWNERS last-match precedence by the service team; see CODEOWNERS.
func Handle${serviceIndex}() string {
	return "${relative}"
}
`;
  }
  return `export function handle${serviceIndex}() {
  // Owned via CODEOWNERS last-match precedence by the service team; see CODEOWNERS.
  return "${relative}";
}
`;
}

// The complete set of service-directory file paths owned by @benchmark-service-team
// under last-match precedence, in deterministic order. This is the ownership
// expected answer's owned-path set; its size equals scale.serviceFiles.
function serviceOwnedFiles(scale) {
  const files = [];
  for (let serviceIndex = 0; serviceIndex < scale.serviceFiles; serviceIndex += 1) {
    files.push(serviceOwnedFileRelativePath(serviceIndex).split(path.sep).join("/"));
  }
  return files;
}

function sourcePathAndContent(index, workspace, workspaceCount = 1) {
  const profile = codeProfiles[index % codeProfiles.length];
  const relativePath = path.join("packages", workspace, profile.directory, `route-${index}.${profile.extension}`);
  // The first source file of each workspace (one per workspace, taken from the
  // leading files) is a TypeScript bridge that imports the spine-target workspace
  // package, so a real cross-workspace import edge exists in the index alongside
  // the package.json dependency edge.
  const workspaceIndex = index % workspaceCount;
  const dependencyTarget = spineDependencyTarget(workspaceIndex);
  if (index < workspaceCount && dependencyTarget !== null) {
    const bridgePath = path.join("packages", workspace, "src", `bridge-${index}.ts`);
    return {
      relativePath: bridgePath,
      content: `import { route${dependencyTarget} } from "@benchmark/workspace-${dependencyTarget}";

export function bridge${index}() {
  return route${dependencyTarget}();
}
`,
    };
  }
  return {
    relativePath,
    content: profile.content(index, workspace),
  };
}

// A7 CODEOWNERS precedence model.
//
// The ownership question targets packages/workspace-0/src/service/handler.go,
// which is matched by SEVERAL rules; under CODEOWNERS last-matching-rule-wins
// precedence the winner is the LAST rule in the file whose pattern matches. The
// generated rule set is built in increasing specificity so a later, more specific
// rule deliberately overrides an earlier, broader one for this path:
//   1. `*`                                    -> @benchmark-org-default (broadest)
//   2. extension rules (`*.go`, `*.py`, ...)  -> per-language owners
//   3. per-workspace dir rules                -> @benchmark-team-(K%5)
//   4. per-workspace src overrides            -> @benchmark-src-team-(K%4)
//   5. the workspace-0 service override       -> @benchmark-service-team (WINNER)
//   6. distinct distractor rules to scale     -> never match the target
// So handler.go is matched by rules 1, 2(*.go), 3(workspace-0 dir),
// 4(workspace-0 src) and 5(service), and only by evaluating precedence does the
// agent reach @benchmark-service-team rather than @go-benchmark-team (the first
// extension match) or @benchmark-org-default (the broadest match).
const CODEOWNERS_TARGET_PATH = "packages/workspace-0/src/service/handler.go";
const CODEOWNERS_SERVICE_OWNER = "@benchmark-service-team";

// Extension rules interleaved among the precedence layers. Order is fixed
// (deterministic); *.go is intentionally before the workspace/src/service
// overrides so the target's correct owner is NOT the extension owner.
const CODEOWNERS_EXTENSION_OWNERS = [
  ["*.go", "@go-benchmark-team"],
  ["*.py", "@python-benchmark-team"],
  ["*.ts", "@ts-benchmark-team"],
  ["*.tsx", "@ui-benchmark-team"],
  ["*.rs", "@rust-benchmark-team"],
  ["*.java", "@jvm-benchmark-team"],
  ["*.yaml", "@config-benchmark-team"],
];

// Build the deterministic, scale-proportional CODEOWNERS rule list as ordered
// [pattern, owner] pairs. The number of rules meets scale.codeownersRules; the
// overlapping-precedence rules that the ownership question depends on are always
// present, and the remainder are distinct non-matching distractor rules that pad
// the file to the scale's rule count (so ownership requires precedence evaluation
// over a realistically large rule set, not a three-line read).
function codeownersRulePairs(scale, workspaceCount) {
  const rules = [];
  // 1. broadest catch-all.
  rules.push(["*", "@benchmark-org-default"]);
  // 2. extension rules (interleaved language ownership).
  for (const [pattern, owner] of CODEOWNERS_EXTENSION_OWNERS) rules.push([pattern, owner]);
  // 3. per-workspace directory rules (override the catch-all for each workspace).
  for (let k = 0; k < workspaceCount; k += 1) {
    rules.push([`/packages/workspace-${k}/`, `@benchmark-team-${k % 5}`]);
  }
  // 4. per-workspace src overrides (override the dir rule, more specific).
  for (let k = 0; k < workspaceCount; k += 1) {
    rules.push([`/packages/workspace-${k}/src/`, `@benchmark-src-team-${k % 4}`]);
  }
  // 5. the workspace-0 service override — the LAST rule that matches the target.
  rules.push([`/packages/workspace-0/src/service/`, CODEOWNERS_SERVICE_OWNER]);
  // 6. distinct distractor rules padding to the scale rule count. They are deeper,
  // non-overlapping paths that never match the target, so they raise the rule
  // count (and the precedence search space) without changing the answer. Indexed
  // deterministically; owners cycle through a fixed handle space.
  let distractor = 0;
  while (rules.length < scale.codeownersRules) {
    const workspaceForRule = distractor % Math.max(workspaceCount, 1);
    rules.push([
      `/packages/workspace-${workspaceForRule}/module-${distractor}/feature-${distractor}/`,
      `@benchmark-area-team-${distractor % 9}`,
    ]);
    distractor += 1;
  }
  return rules;
}

function renderCodeowners(rulePairs) {
  return `${rulePairs.map(([pattern, owner]) => `${pattern} ${owner}`).join("\n")}\n`;
}

// Last-match-wins CODEOWNERS resolver used BOTH to compute the expected ownership
// answer at generation time and (via the unit tests) to prove the precedence
// logic. Implements the subset of gitignore/CODEOWNERS glob semantics the
// generated rules use: `*` (everything), `*.ext` (extension match on the
// basename), an anchored directory prefix (`/dir/` or `/dir/sub/`, matching any
// path under that directory), and an exact anchored path. Returns the owner of
// the LAST matching rule, or null if no rule matches. Throws on an unrecognized
// pattern shape so a future rule form cannot silently resolve wrong.
function codeownersPatternMatches(pattern, targetPath) {
  if (pattern === "*") return true;
  if (pattern.startsWith("*.")) {
    const extension = pattern.slice(1); // ".go"
    return targetPath.endsWith(extension);
  }
  if (pattern.startsWith("/")) {
    const anchored = pattern.slice(1);
    if (anchored.endsWith("/")) {
      return targetPath.startsWith(anchored);
    }
    return targetPath === anchored;
  }
  throw new Error(`unsupported CODEOWNERS pattern shape in benchmark resolver: ${pattern}`);
}

function resolveCodeownersOwner(rulePairs, targetPath) {
  let owner = null;
  for (const [pattern, ruleOwner] of rulePairs) {
    if (codeownersPatternMatches(pattern, targetPath)) owner = ruleOwner;
  }
  return owner;
}

// The set of distinct files an agent must read to derive each code_graph family's
// expected answer at a given scale. Used by the build-time derivation-file-count
// assert; the count must meet scale.minDerivationFiles. The sets are the actual
// evidence files (not a padded list): the import-chain files for impact_trace, the
// workspace bridge/package.json files along the spine for workspace_graph, and the
// CODEOWNERS file plus the matching-rule evidence for ownership_lookup.
function derivationFilesForFamily(taskFamily, scale, workspaceCount) {
  if (taskFamily === "impact_trace") {
    // mod-0 plus every transitive importer module: the whole chain must be read to
    // confirm the transitive set and that the chain terminates.
    const files = [];
    for (let chainIndex = 0; chainIndex < scale.importChain; chainIndex += 1) {
      files.push(fileChainModuleRelativePath(chainIndex).split(path.sep).join("/"));
    }
    return files;
  }
  if (taskFamily === "workspace_graph") {
    // The leaf plus every transitive dependency workspace contributes its bridge
    // file AND its package.json (both edges must agree), so the derivation reads
    // 2 files per workspace along the spine.
    const files = [];
    for (let k = 0; k < workspaceCount; k += 1) {
      files.push(`packages/workspace-${k}/package.json`);
      if (k >= 1) files.push(`packages/workspace-${k}/src/bridge-${k}.ts`);
    }
    return files;
  }
  if (taskFamily === "ownership_lookup") {
    // The ownership answer is the COMPLETE set of files under the service directory
    // that @benchmark-service-team owns under last-match precedence. Deriving it
    // requires reading CODEOWNERS (to know the service rule wins) and enumerating
    // every service file (to list the owned set), so the distinct evidence is
    // CODEOWNERS plus every owned service file.
    return ["CODEOWNERS", ...serviceOwnedFiles(scale)];
  }
  throw new Error(`no derivation file set for task family: ${taskFamily}`);
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
  // A7: scale-proportional CODEOWNERS with overlapping last-match-wins precedence.
  writeFile(path.join(root, "CODEOWNERS"), renderCodeowners(codeownersRulePairs(scale, scale.workspaces)));

  for (let index = 0; index < scale.codeFiles; index += 1) {
    const workspaceIndex = index % scale.workspaces;
    const workspace = `workspace-${workspaceIndex}`;
    if (index < scale.workspaces) {
      writeFile(path.join(root, "packages", workspace, "package.json"), `${JSON.stringify({
        name: `@benchmark/${workspace}`,
        private: true,
        dependencies: {
          express: "latest",
          ...internalWorkspaceDependencies(workspaceIndex),
        },
      }, null, 2)}\n`);
    }
    const source = sourcePathAndContent(index, workspace, scale.workspaces);
    writeFile(path.join(root, source.relativePath), source.content);
  }

  // A7 intra-workspace file import chain in workspace-0/src (mod-0 <- ... <-
  // mod-(C-1)); impact_trace's transitive importer answer is derived from these
  // edges. Planted after the index-based files so the chain modules have stable
  // dedicated names that never collide with route-*/bridge-* files.
  for (let chainIndex = 0; chainIndex < scale.importChain; chainIndex += 1) {
    writeFile(path.join(root, fileChainModuleRelativePath(chainIndex)), fileChainModuleContent(chainIndex));
  }

  // A7 ownership owned-set: plant the full service-directory file set under
  // packages/workspace-0/src/service/. handler.go (serviceIndex 0) is the named
  // anchor the prompt references; the rest extend the owned set so deriving the
  // complete @benchmark-service-team-owned set requires enumerating the directory
  // and confirming last-match precedence for each (CODEOWNERS + scale.serviceFiles
  // reads). File contents carry no owner handle — owner handles live only in
  // CODEOWNERS so the docs-only and no-answer-leak rules hold.
  for (let serviceIndex = 0; serviceIndex < scale.serviceFiles; serviceIndex += 1) {
    writeFile(path.join(root, serviceOwnedFileRelativePath(serviceIndex)), serviceOwnedFileContent(serviceIndex));
  }
}

// Code-graph correctness expectations are computed deterministically from the
// same base-repo generation rules used by materializeBaseRepo, so the expected
// answer is derivable only from code-derived evidence (import edges, CODEOWNERS
// rules, the workspace package.json graph). The returned object mirrors the
// static expectations shape in llm-correctness.js plus an answer_key_terms list
// of distinctive code-derived strings that the docs-only gate forbids in any
// Markdown file. Both conditions share the base repo, so evidence_by_condition
// points the agent at the same code files in either condition.
// workspace_graph answers always cite @benchmark/workspace-* package names as
// their code evidence (the dependency chain), so that token is accepted alongside
// packages/ and CODEOWNERS as a valid code-surface citation.
const codeGraphEvidenceByCondition = {
  with_project_librarian: [["packages/", "CODEOWNERS", "@benchmark/workspace-"]],
  without_project_librarian: [["packages/", "CODEOWNERS", "@benchmark/workspace-"]],
};

function codeGraphExpectation(taskFamily, scaleName) {
  const scale = scales[scaleName];
  if (!scale) throw new Error(`unknown scale: ${scaleName}`);
  const workspaceCount = scale.workspaces;

  if (taskFamily === "ownership_lookup") {
    // A7: the answer is the LAST-matching rule's owner for the service directory
    // (computed with the same resolver the unit tests exercise) PLUS the full set
    // of service files that owner owns. The owner is deterministically
    // @benchmark-service-team (the service override is the last rule that matches),
    // NOT the *.go extension owner that a first-match or grep-the-extension
    // approach reports. Requiring the owned file set too forces enumerating the
    // directory, so the answer cannot come from a single CODEOWNERS read. The owner
    // handle exists only in CODEOWNERS; the file paths exist only in code.
    const owner = resolveCodeownersOwner(codeownersRulePairs(scale, workspaceCount), CODEOWNERS_TARGET_PATH);
    if (owner !== CODEOWNERS_SERVICE_OWNER) {
      throw new Error(`CODEOWNERS precedence drift: expected ${CODEOWNERS_SERVICE_OWNER} for ${CODEOWNERS_TARGET_PATH}, resolver returned ${owner}`);
    }
    const ownedFiles = serviceOwnedFiles(scale);
    return {
      // The owner handle plus every owned file path must appear: a correct answer
      // names the winning owner AND enumerates the full owned set.
      required_terms: [owner, ...ownedFiles],
      // A correct answer must show it evaluated precedence, not just grepped *.go.
      any_terms: [["CODEOWNERS", "owner", "precedence", "last match", "last-match"]],
      // "I cannot access" is a refusal sentinel — always wrong.
      // @go-benchmark-team is the classic first-match / extension-only wrong answer;
      // however, a CORRECT answer often QUOTES that rule as part of the precedence
      // chain, so a bare forbidden_terms substring check would fail correct answers.
      // We use designation_forbidden instead: the check fails only if a line in the
      // response DESIGNATES @go-benchmark-team as the owner (contains "owner"/"owns"/
      // "owned" + the team handle) WITHOUT also mentioning the correct owner as the
      // override winner on that same line.  Quoting "*.go @go-benchmark-team" in a
      // rule-list line (no designation word) always passes.
      forbidden_terms: ["I cannot access"],
      designation_forbidden: [{ team: "@go-benchmark-team", correct_owner: owner }],
      evidence_by_condition: {
        with_project_librarian: [["CODEOWNERS"]],
        without_project_librarian: [["CODEOWNERS"]],
      },
      // Owner handle and the owned file paths are the distinctive code-derived
      // tokens; forbid them all from appearing in any Markdown file.
      answer_key_terms: [owner, ...ownedFiles],
    };
  }

  if (taskFamily === "impact_trace") {
    // A7: the answer is the TRANSITIVE importer set of the file-chain root
    // packages/workspace-0/src/mod-0.ts, i.e. every chain module mod-1 ..
    // mod-(C-1). The chain exists at every scale (small included), so the answer is
    // a concrete multi-file set, removing the prior small-scale ambiguity. A grep
    // for the root finds only the direct importer (mod-1); the rest require
    // following the chain, so every transitive importer is a required term.
    const importerPaths = transitiveImportersOfChainRoot(scale.importChain);
    if (importerPaths.length === 0) {
      throw new Error(`impact_trace expectation requires a non-empty import chain at scale ${scaleName}`);
    }
    return {
      required_terms: importerPaths,
      any_terms: [["import", "transitive", "depends", "chain"]],
      forbidden_terms: ["I cannot access"],
      evidence_by_condition: codeGraphEvidenceByCondition,
      // The deepest chain module path is the most distinctive code-derived token;
      // the full path list is also distinctive, so forbid every importer path from
      // appearing in any Markdown file (the answer must come from code only).
      answer_key_terms: importerPaths,
    };
  }

  if (taskFamily === "workspace_graph") {
    // A7: the answer is the TRANSITIVE workspace dependency set of the deepest
    // workspace (workspace-(W-1)) under the spine K -> K-1, i.e. every lower
    // workspace package name. At W <= 1 there is no chain, so the deterministic
    // answer is "only workspace-0" (small keeps a concrete, unambiguous answer).
    if (workspaceCount <= 1) {
      return {
        required_terms: ["@benchmark/workspace-0"],
        any_terms: [["no internal", "none", "single workspace", "only workspace", "no workspace-to-workspace"]],
        forbidden_terms: ["I cannot access"],
        evidence_by_condition: codeGraphEvidenceByCondition,
        answer_key_terms: [],
      };
    }
    const transitiveDeps = transitiveWorkspaceDependenciesOfLeaf(workspaceCount);
    // Every transitive dependency package name is required (the full chain). The
    // deepest dependency (@benchmark/workspace-0) is the distinctive code-derived
    // token that only traversal reaches; use the full set as answer keys so none
    // of the chain leaks into Markdown.
    return {
      required_terms: transitiveDeps,
      any_terms: [["depends", "dependency", "transitive", "workspace:", "chain"]],
      forbidden_terms: ["I cannot access"],
      evidence_by_condition: codeGraphEvidenceByCondition,
      answer_key_terms: transitiveDeps,
    };
  }

  throw new Error(`no code-graph expectation for task family: ${taskFamily}`);
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

// docs-only answerability gate: a code_graph scenario's distinctive expected
// answer key terms must not appear in any Markdown file under the condition
// root. If a product-generated page (bootstrap or code-index output) trips the
// gate, this throws loudly and names the file and term rather than excluding it.
function assertDocsOnlyAnswerability(root, codeGraphExpectations) {
  const terms = [];
  for (const expectation of codeGraphExpectations) {
    for (const term of expectation.answer_key_terms || []) {
      if (term && !terms.includes(term)) terms.push(term);
    }
  }
  if (terms.length === 0) return;
  for (const filePath of markdownFilesUnder(root)) {
    const content = fs.readFileSync(filePath, "utf8");
    for (const term of terms) {
      if (content.includes(term)) {
        const relative = path.relative(root, filePath).split(path.sep).join("/");
        throw new Error(`docs-only answerability gate failed: code_graph answer key term "${term}" appears in Markdown file ${relative}; code-graph answers must be derivable only from code evidence`);
      }
    }
  }
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

// A7 build-time structural asserts (throw on violation, no fallback). Verifies,
// against the on-disk fixture, that the generated code structure meets the scale's
// representativeness bounds so the code_graph questions genuinely require traversal
// and a control cannot answer from one tiny read. Three bounds, each with a clear
// error naming the violated minimum:
//   1. CODEOWNERS rule count >= scale.codeownersRules.
//   2. cross-workspace dependency chain depth (workspaces - 1) >= the scale's
//      MIN_WORKSPACE_CHAIN_DEPTH, AND the import file chain length matches scale.
//   3. for each code_graph family, the number of DISTINCT files required to derive
//      its expected answer >= scale.minDerivationFiles, with every derivation file
//      actually present on disk (so the count is real evidence, not a padded list).
// These encode bounds (structure realism), never a desired delta.
const CODE_GRAPH_FAMILIES = ["impact_trace", "ownership_lookup", "workspace_graph"];

function assertCodeStructureBounds(root, scaleName) {
  const scale = scales[scaleName];
  if (!scale) throw new Error(`unknown scale: ${scaleName}`);
  const workspaceCount = scale.workspaces;

  // 1. CODEOWNERS rule count.
  const codeownersPath = path.join(root, "CODEOWNERS");
  if (!fs.existsSync(codeownersPath)) {
    throw new Error(`code-structure assert: missing CODEOWNERS at ${root}`);
  }
  const ruleLines = fs.readFileSync(codeownersPath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  if (ruleLines.length < scale.codeownersRules) {
    throw new Error(`code-structure assert failed: CODEOWNERS has ${ruleLines.length} rules at scale ${scaleName}, below the required minimum of ${scale.codeownersRules}; ownership must require evaluating precedence over many rules`);
  }
  // The last-match-wins answer must resolve to the service override; a CODEOWNERS
  // that lost the precedence-overlap rules would make the question trivial.
  const resolvedOwner = resolveCodeownersOwner(ruleLines.map((line) => {
    const spaceIndex = line.indexOf(" ");
    return [line.slice(0, spaceIndex), line.slice(spaceIndex + 1).trim()];
  }), CODEOWNERS_TARGET_PATH);
  if (resolvedOwner !== CODEOWNERS_SERVICE_OWNER) {
    throw new Error(`code-structure assert failed: CODEOWNERS last-match owner of ${CODEOWNERS_TARGET_PATH} resolved to ${resolvedOwner}, expected ${CODEOWNERS_SERVICE_OWNER}; the precedence-overlap rules are missing or out of order`);
  }

  // 2. dependency chain depth and import chain length.
  const chainDepth = Math.max(workspaceCount - 1, 0);
  const requiredDepth = MIN_WORKSPACE_CHAIN_DEPTH[scaleName] ?? 0;
  if (chainDepth < requiredDepth) {
    throw new Error(`code-structure assert failed: cross-workspace dependency chain depth ${chainDepth} at scale ${scaleName} is below the required minimum ${requiredDepth}; transitive workspace questions must need depth-${requiredDepth}+ traversal`);
  }
  const chainRoot = path.join(root, fileChainModuleRelativePath(scale.importChain - 1));
  if (!fs.existsSync(chainRoot)) {
    throw new Error(`code-structure assert failed: import chain module ${fileChainModuleRelativePath(scale.importChain - 1)} missing; the import chain is shorter than the scale's ${scale.importChain}`);
  }

  // 3. derivation-file count per code_graph family.
  for (const family of CODE_GRAPH_FAMILIES) {
    const files = derivationFilesForFamily(family, scale, workspaceCount);
    const distinct = [...new Set(files)];
    for (const relative of distinct) {
      if (!fs.existsSync(path.join(root, relative))) {
        throw new Error(`code-structure assert failed: derivation file ${relative} for ${family} at scale ${scaleName} is missing on disk; the derivation-file count must reflect real evidence`);
      }
    }
    if (distinct.length < scale.minDerivationFiles) {
      throw new Error(`code-structure assert failed: deriving the ${family} answer at scale ${scaleName} reads ${distinct.length} distinct files, below the required minimum of ${scale.minDerivationFiles}; a control must not be able to answer from one read`);
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

// Code-graph families query the code-evidence index through the installed local
// runner. The agent invokes it with a read-only SQL query against the generated
// SQLite database; this command must succeed under the read-only sandbox the
// scenario runs in. The list mirrors the schema in src/code-index.ts (imports,
// configs) and is used both for the planted pointer and the post-build query
// verification. It names the tool and query shape only, never an answer.
const codeIndexQueryRelativeCommand = "node tools/project-librarian/dist/init-project-wiki.js --code-query \"<read-only SELECT>\"";

// A7: the example queries name the QUERY SHAPE only and embed no answer token.
// They deliberately use placeholder targets (a generic module path, the
// workspace-package LIKE prefix) so the pointer page teaches how to traverse the
// import/dependency edges without containing any code_graph answer key term — the
// docs-only gate would reject any answer-bearing string here. Transitive answers
// (the full importer/dependency chains) are never queryable in one row; the agent
// must follow from_file -> to_ref edges iteratively.
const codeGraphQueryExamples = [
  {
    family: "impact_trace",
    description: "direct importers of a module by its import specifier (follow edges transitively for the full set)",
    sql: "SELECT DISTINCT from_file FROM imports WHERE to_ref = './mod-<n>'",
  },
  {
    family: "ownership_lookup",
    description: "CODEOWNERS rules are in the CODEOWNERS file; read it and apply last-match-wins precedence",
    sql: "SELECT path FROM files WHERE path = 'CODEOWNERS'",
  },
  {
    family: "workspace_graph",
    description: "workspace-to-workspace package.json dependency edges (traverse for the transitive set)",
    sql: "SELECT file_path, key, value FROM configs WHERE key LIKE 'dependency:@benchmark/workspace-%'",
  },
];

// A short planted wiki page that points the with-condition agent at the local
// runner query path. It deliberately names the command and example queries only;
// it never contains an answer key term (the docs-only gate would reject it).
function codeEvidenceQueryPointerPage() {
  const examples = codeGraphQueryExamples
    .map((example) => `- ${example.description}:\n  \`${codeIndexQueryRelativeCommand.replace("<read-only SELECT>", example.sql)}\``)
    .join("\n");
  return `---
status: active
updated: 2026-06-10
scope: benchmark-fixture
read_budget: short
decision_ref: none
review_trigger: benchmark fixture regeneration
---

# Code Evidence Query

This repository ships a local Project Librarian runner under \`tools/project-librarian/dist/\`. Query the code-evidence index with read-only SQL from the repository root:

\`${codeIndexQueryRelativeCommand}\`

The index tables include \`files\`, \`imports\` (from_file, to_ref), \`configs\` (key, value, file_path), \`symbols\`, and \`edges\`. Example queries:

${examples}

Run \`node tools/project-librarian/dist/init-project-wiki.js --code-status\` to confirm the index is populated. Queries are read-only and must start with SELECT or WITH.
`;
}

// Verify the installed runner can answer a code-graph query against the freshly
// built fixture under the same read-only invocation agents use. Throws loudly on
// failure rather than degrading, per the no-fallback rule.
function verifyInstalledRunnerQuery(root, installedCliRelative) {
  const installedCli = path.join(root, installedCliRelative);
  const output = runProjectLibrarian(installedCli, ["--code-query", "SELECT count(*) AS files FROM files"], root);
  let rows;
  try {
    rows = JSON.parse(output);
  } catch (error) {
    throw new Error(`installed runner code-query did not return JSON rows: ${error.message}; output: ${output.slice(0, 200)}`);
  }
  if (!Array.isArray(rows) || rows.length !== 1 || !Number.isFinite(rows[0].files) || rows[0].files <= 0) {
    throw new Error(`installed runner code-query returned no indexed files: ${output.slice(0, 200)}`);
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
      with_project_librarian: [["wiki/canonical/dated-decision-0.md", "wiki/canonical/dated-decision-1.md", "wiki/canonical/dated-decision-2.md", "wiki/canonical/dated-decision-3.md"]],
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
  writeFile(path.join(root, "wiki", "canonical", "code-evidence-query.md"), codeEvidenceQueryPointerPage());
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

  runProjectLibrarian(cliPath, ["--code-index", "--code-scope", "packages", "--code-scope", "package.json", "--code-scope", "CODEOWNERS"], root);

  // Install the built CLI so an agent inside the read-only sandbox can query the
  // code-evidence index offline, then convert the index out of WAL mode so the
  // query path works without write access. Verify the query path against the
  // freshly built fixture before returning.
  const installedCliRelative = installLocalRunner(root, cliPath);
  convertCodeIndexForReadOnlyQuery(path.join(root, codeEvidenceRelativeDatabasePath()));
  verifyInstalledRunnerQuery(root, installedCliRelative);
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
  // Expectation sourcing:
  //   - code_graph: scale-dependent expectation computed from code evidence.
  //   - aggregation: deterministic ground-truth inventory (scale-independent set,
  //     scattered one-per-page); validator recomputes from raw JSONL + this.
  //   - other wiki families (incl. multi_session): static expectations map in
  //     llm-correctness.js keyed by task_family; carry expectation: null.
  let expectation = null;
  if (benchmarkTrack === "code_graph") {
    expectation = codeGraphExpectation(taskFamily, scale);
  } else if (taskFamily === "aggregation") {
    expectation = aggregationExpectation();
  }

  const base = {
    scale,
    condition,
    benchmark_track: benchmarkTrack,
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

// Compute the code_graph expectations for a scale once, keyed by task family, so
// the docs-only gate, the manifest, and correctness recomputation all share the
// same scale-dependent expected answers.
function codeGraphExpectationsForScale(scale) {
  const expectations = {};
  for (const [family, definition] of Object.entries(taskFamilyDefinitions)) {
    if (definition.benchmark_track === "code_graph") {
      expectations[family] = codeGraphExpectation(family, scale);
    }
  }
  return expectations;
}

function materializeFixturePair(fixtureRoot, scale, cliPath, controlProfile = "organic") {
  const withRoot = path.join(fixtureRoot, scale, "with_project_librarian");
  const withoutRoot = path.join(fixtureRoot, scale, "without_project_librarian");
  materializeWithProjectLibrarian(withRoot, scale, cliPath);
  materializeWithoutProjectLibrarian(withoutRoot, scale, controlProfile);

  // docs-only answerability gate: code_graph answers must not appear in any
  // Markdown file under either condition root, including pages the product
  // itself generated (bootstrap/code-index output). Failures throw loudly.
  const codeGraphExpectations = Object.values(codeGraphExpectationsForScale(scale));
  assertDocsOnlyAnswerability(withRoot, codeGraphExpectations);
  assertDocsOnlyAnswerability(withoutRoot, codeGraphExpectations);

  // A3 no-single-page-aggregate gate: the aggregation answer must require
  // synthesizing facts scattered across multiple pages, so no single Markdown page
  // in either condition may carry the full dated-decision inventory. The gate runs
  // TWICE per condition — once for the prose-summary term set (no_single_page_terms)
  // and once for the date-string term set (required_terms) — so BOTH violation shapes
  // are caught: a history page that lists all prose summaries, and a history page that
  // enumerates all dates (the most common violation shape, ~4/5 triggers). The
  // individual dated facts are planted one-per-page above; this asserts the invariant
  // in both conditions. Always run (the aggregation pages are always planted),
  // mirroring the always-on docs-only gate.
  const aggExpectation = aggregationExpectation();
  assertNoSinglePageAggregate(withRoot, aggExpectation.no_single_page_terms);
  assertNoSinglePageAggregate(withRoot, aggExpectation.required_terms);
  assertNoSinglePageAggregate(withoutRoot, aggExpectation.no_single_page_terms);
  assertNoSinglePageAggregate(withoutRoot, aggExpectation.required_terms);

  // A7 structural bounds: both condition roots share the base repo, so the
  // CODEOWNERS rule count, dependency-chain depth, and per-family derivation-file
  // count must meet the scale minimums in each. Throws loudly on a violation.
  assertCodeStructureBounds(withRoot, scale);
  assertCodeStructureBounds(withoutRoot, scale);
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
    // schema_version 4 (A3) adds the multi_session `sessions`/`session_count`
    // fields and the aggregation `expectation` (an aggregate-component inventory)
    // on the relevant scenarios; `sessions` is folded into the manifest
    // fingerprint so both session prompts are part of provenance. schema_version 3
    // added control_profile (A2) to the manifest top level and to every scenario.
    schema_version: 4,
    benchmark_kind: "codex-actual-llm-manifest",
    generated_at: new Date().toISOString(),
    fixture_root: fixtureRoot,
    scales: selectedScales,
    conditions,
    benchmark_tracks: presentTracks,
    control_profile: controlProfile,
    task_families: selectedTasks,
    task_tracks: taskTracksForSelected,
    requested_model: requestedModel || null,
    manifest_fingerprint: sha256(JSON.stringify(scenarios.map((scenario) => ({
      scale: scenario.scale,
      condition: scenario.condition,
      benchmark_track: scenario.benchmark_track,
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
  CODEOWNERS_SERVICE_OWNER,
  CODEOWNERS_TARGET_PATH,
  MIN_WORKSPACE_CHAIN_DEPTH,
  SEEDED_DECISION,
  aggregationExpectation,
  aggregationGroundTruth,
  assertBoundedAnswerReachability,
  assertCodeStructureBounds,
  assertDocsOnlyAnswerability,
  assertNoSinglePageAggregate,
  assertRouterTruthConsistency,
  benchmarkTracks,
  buildManifest,
  codeGraphExpectation,
  codeGraphExpectationsForScale,
  codeownersRulePairs,
  conditions,
  controlProfiles,
  derivationFilesForFamily,
  fingerprintDirectory,
  maintainedIndex,
  maintainedRecentDecisions,
  maintainedStartup,
  materializeFixturePair,
  resolveCodeownersOwner,
  scales,
  taskFamilies,
  taskFamilyDefinitions,
  taskTracks,
  trackForTaskFamily,
  transitiveImportersOfChainRoot,
  transitiveWorkspaceDependenciesOfLeaf,
};
