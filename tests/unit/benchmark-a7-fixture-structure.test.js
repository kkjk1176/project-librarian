"use strict";

// A7 (fixture-structure deepening) unit tests. These exercise the pure pieces of
// the deeper code-graph structure and NEVER execute real codex: the generation-time
// CODEOWNERS last-match resolver, the transitive importer/dependency set
// computation, expectation determinism, the build-time structural asserts (pass +
// each violation path), and the correctness evaluator's robustness to legitimate
// path-list phrasings (backticks/ordering) without weakening the requirement.
// Fixture builds are tmp-confined; resolver/expectation tests need no CLI.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  CODEOWNERS_SERVICE_OWNER,
  CODEOWNERS_TARGET_PATH,
  MIN_WORKSPACE_CHAIN_DEPTH,
  assertCodeStructureBounds,
  codeGraphExpectation,
  codeownersRulePairs,
  derivationFilesForFamily,
  materializeFixturePair,
  resolveCodeownersOwner,
  scales,
  transitiveImportersOfChainRoot,
  transitiveWorkspaceDependenciesOfLeaf,
} = require("../../benchmarks/lib/llm-fixtures");
const { evaluateCorrectness } = require("../../benchmarks/lib/llm-correctness");

const cliPath = path.resolve(__dirname, "..", "..", "dist", "init-project-wiki.js");
const skip = !fs.existsSync(cliPath) ? "dist CLI not built" : false;

function makeTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const codeGraphFamilies = ["impact_trace", "ownership_lookup", "workspace_graph"];

// --- CODEOWNERS last-match-wins resolver -------------------------------------

test("CODEOWNERS resolver applies last-matching-rule-wins precedence", () => {
  // A hand-built rule set with overlapping matches: the later, more specific rule
  // must win over earlier broader rules for the target path.
  const rules = [
    ["*", "@org-default"],
    ["*.go", "@go-team"],
    ["/packages/workspace-0/", "@ws0-team"],
    ["/packages/workspace-0/src/", "@ws0-src-team"],
    ["/packages/workspace-0/src/service/", "@service-team"],
    ["/packages/workspace-1/feature/", "@elsewhere"],
  ];
  // service file: every rule except the workspace-1 one matches; last match wins.
  assert.equal(resolveCodeownersOwner(rules, "packages/workspace-0/src/service/handler.go"), "@service-team");
  // a src file NOT under service/: the src override is the last match.
  assert.equal(resolveCodeownersOwner(rules, "packages/workspace-0/src/util.go"), "@ws0-src-team");
  // a workspace-0 file outside src/: the workspace dir rule is the last match.
  assert.equal(resolveCodeownersOwner(rules, "packages/workspace-0/readme.go"), "@ws0-team");
  // a .go file outside any workspace dir: only `*` and `*.go` match; *.go wins.
  assert.equal(resolveCodeownersOwner(rules, "tools/script.go"), "@go-team");
  // a path matched only by the catch-all.
  assert.equal(resolveCodeownersOwner(rules, "README.md"), "@org-default");
});

test("CODEOWNERS resolver returns null when no rule matches and throws on unknown shapes", () => {
  assert.equal(resolveCodeownersOwner([["/only/here/", "@x"]], "somewhere/else.txt"), null);
  // An unsupported pattern shape (a bare relative glob) must throw, not silently miss.
  assert.throws(() => resolveCodeownersOwner([["docs/**", "@x"]], "docs/a.md"), /unsupported CODEOWNERS pattern shape/);
});

test("generated CODEOWNERS resolves the service path to the service owner at every scale", () => {
  for (const scale of Object.keys(scales)) {
    const rules = codeownersRulePairs(scales[scale], scales[scale].workspaces);
    assert(rules.length >= scales[scale].codeownersRules, `${scale} rule count`);
    assert.equal(resolveCodeownersOwner(rules, CODEOWNERS_TARGET_PATH), CODEOWNERS_SERVICE_OWNER);
    // The first extension match (*.go owner) must NOT be the winner — precedence matters.
    assert.notEqual(resolveCodeownersOwner(rules, CODEOWNERS_TARGET_PATH), "@go-benchmark-team");
  }
});

// --- transitive set computation ----------------------------------------------

test("transitive importer set is the full chain tail, deterministic", () => {
  assert.deepEqual(transitiveImportersOfChainRoot(4), [
    "packages/workspace-0/src/mod-1.ts",
    "packages/workspace-0/src/mod-2.ts",
    "packages/workspace-0/src/mod-3.ts",
  ]);
  assert.deepEqual(transitiveImportersOfChainRoot(1), []);
  assert.deepEqual(transitiveImportersOfChainRoot(4), transitiveImportersOfChainRoot(4));
});

test("transitive workspace dependency set walks the spine down to workspace-0", () => {
  // leaf = workspace-(W-1); deps are workspace-(W-2) .. workspace-0, nearest first.
  assert.deepEqual(transitiveWorkspaceDependenciesOfLeaf(4), [
    "@benchmark/workspace-2",
    "@benchmark/workspace-1",
    "@benchmark/workspace-0",
  ]);
  assert.deepEqual(transitiveWorkspaceDependenciesOfLeaf(1), []);
  assert.deepEqual(transitiveWorkspaceDependenciesOfLeaf(0), []);
});

test("code-graph expectations remain deterministic per scale", () => {
  for (const scale of Object.keys(scales)) {
    for (const family of codeGraphFamilies) {
      assert.deepEqual(codeGraphExpectation(family, scale), codeGraphExpectation(family, scale));
    }
  }
});

// --- derivation file counts meet the scale minimum ----------------------------

test("each code_graph family's derivation reads at least the scale minimum distinct files", () => {
  for (const scale of Object.keys(scales)) {
    const min = scales[scale].minDerivationFiles;
    for (const family of codeGraphFamilies) {
      const files = derivationFilesForFamily(family, scales[scale], scales[scale].workspaces);
      const distinct = new Set(files);
      assert.equal(distinct.size, files.length, `${family}/${scale} derivation files must be distinct`);
      assert(distinct.size >= min, `${family}/${scale} reads ${distinct.size} files, need >= ${min}`);
    }
  }
});

// --- build-time structural asserts: violation paths (synthetic on-disk trees) --

function writeFile(root, relative, content) {
  const abs = path.join(root, relative);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

// Build a minimal on-disk tree that SATISFIES the medium structural bounds, so each
// violation test can knock out exactly one property and confirm the targeted throw.
function seedStructurallyValidMedium(root) {
  const scale = scales.medium;
  const workspaceCount = scale.workspaces;
  // CODEOWNERS with the real generated rules (meets count + precedence).
  const rules = codeownersRulePairs(scale, workspaceCount);
  writeFile(root, "CODEOWNERS", `${rules.map(([p, o]) => `${p} ${o}`).join("\n")}\n`);
  // Import chain root through tail.
  for (let i = 0; i < scale.importChain; i += 1) {
    writeFile(root, `packages/workspace-0/src/mod-${i}.ts`, `// mod-${i}\n`);
  }
  // Service owned files.
  for (const family of ["ownership_lookup", "workspace_graph", "impact_trace"]) {
    for (const rel of derivationFilesForFamily(family, scale, workspaceCount)) {
      if (rel === "CODEOWNERS") continue;
      writeFile(root, rel, `// ${rel}\n`);
    }
  }
  return scale;
}

test("structural asserts pass on a structurally valid tree", () => {
  const root = makeTmpDir("a7-struct-pass-");
  try {
    seedStructurallyValidMedium(root);
    assert.doesNotThrow(() => assertCodeStructureBounds(root, "medium"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("structural assert fails when CODEOWNERS has too few rules", () => {
  const root = makeTmpDir("a7-struct-rules-");
  try {
    seedStructurallyValidMedium(root);
    // Truncate CODEOWNERS to a 3-line file (the old trivially-greppable shape).
    writeFile(root, "CODEOWNERS", "/packages/workspace-0/ @a\n*.go @b\n*.py @c\n");
    assert.throws(
      () => assertCodeStructureBounds(root, "medium"),
      (error) => error.message.includes("CODEOWNERS has 3 rules") && error.message.includes("minimum of 80"),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("structural assert fails when CODEOWNERS precedence no longer resolves to the service owner", () => {
  const root = makeTmpDir("a7-struct-prec-");
  try {
    const scale = seedStructurallyValidMedium(root);
    // Keep the rule COUNT high but drop the service override so last-match changes.
    const rules = codeownersRulePairs(scale, scale.workspaces).filter(([p]) => p !== "/packages/workspace-0/src/service/");
    // Pad back to the required count with non-matching distractors so only precedence fails.
    while (rules.length < scale.codeownersRules) rules.push([`/packages/pad-${rules.length}/x/`, `@pad-${rules.length}`]);
    writeFile(root, "CODEOWNERS", `${rules.map(([p, o]) => `${p} ${o}`).join("\n")}\n`);
    assert.throws(
      () => assertCodeStructureBounds(root, "medium"),
      (error) => error.message.includes("last-match owner") && error.message.includes(CODEOWNERS_SERVICE_OWNER),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("structural assert fails when the import chain is too short", () => {
  const root = makeTmpDir("a7-struct-chain-");
  try {
    seedStructurallyValidMedium(root);
    // Remove the deepest chain module so the chain is shorter than scale.importChain.
    fs.rmSync(path.join(root, `packages/workspace-0/src/mod-${scales.medium.importChain - 1}.ts`));
    assert.throws(
      () => assertCodeStructureBounds(root, "medium"),
      (error) => error.message.includes("import chain module") && error.message.includes("missing"),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("structural assert fails when a derivation file is missing on disk", () => {
  const root = makeTmpDir("a7-struct-deriv-");
  try {
    seedStructurallyValidMedium(root);
    // Remove one owned service file: ownership derivation now points at a missing file.
    fs.rmSync(path.join(root, "packages/workspace-0/src/service/handler-5.ts"));
    assert.throws(
      () => assertCodeStructureBounds(root, "medium"),
      (error) => error.message.includes("derivation file") && error.message.includes("missing on disk"),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("workspace chain-depth minimums are defined for every scale", () => {
  for (const scale of Object.keys(scales)) {
    const required = MIN_WORKSPACE_CHAIN_DEPTH[scale];
    assert(Number.isInteger(required), `${scale} chain-depth minimum`);
    // The actual spine depth (workspaces - 1) must meet the declared minimum.
    assert(scales[scale].workspaces - 1 >= required, `${scale} spine depth must meet its minimum`);
  }
});

// --- correctness evaluator robustness to legitimate path-list phrasings -------

test("impact_trace correctness accepts path lists with backticks and any ordering", () => {
  const expectation = codeGraphExpectation("impact_trace", "medium");
  const paths = expectation.required_terms;
  // Reverse order + wrap each path in backticks + interleave prose: still correct,
  // because every expected path is present as a substring.
  const reversedBackticked = [...paths].reverse().map((p) => `\`${p}\``).join(", ");
  const pass = evaluateCorrectness({
    taskFamily: "impact_trace",
    condition: "with_project_librarian",
    benchmarkTrack: "code_graph",
    expectation,
    finalText: `The transitive importers of mod-0 are: ${reversedBackticked}.`,
    fileChangeCount: 0,
  });
  assert.equal(pass.status, "passed", pass.reason);
});

test("impact_trace correctness still fails when a transitive importer is missing", () => {
  const expectation = codeGraphExpectation("impact_trace", "medium");
  // Drop the deepest importer: the requirement is not weakened — every component must be present.
  const partial = expectation.required_terms.slice(0, -1).join(", ");
  const fail = evaluateCorrectness({
    taskFamily: "impact_trace",
    condition: "with_project_librarian",
    benchmarkTrack: "code_graph",
    expectation,
    finalText: `Importers: ${partial}.`,
    fileChangeCount: 0,
  });
  assert.equal(fail.status, "failed");
});

test("ownership_lookup correctness fails when the answer reports the *.go extension owner", () => {
  const expectation = codeGraphExpectation("ownership_lookup", "medium");
  const ownedList = expectation.required_terms.slice(1).join(", ");
  // Mentions the forbidden first-match owner -> fails even though the owned set is listed.
  const fail = evaluateCorrectness({
    taskFamily: "ownership_lookup",
    condition: "with_project_librarian",
    benchmarkTrack: "code_graph",
    expectation,
    finalText: `Owner is @go-benchmark-team (from *.go). Files: ${CODEOWNERS_SERVICE_OWNER} owns ${ownedList}.`,
    fileChangeCount: 0,
  });
  assert.equal(fail.status, "failed");
  // The precedence-correct answer (service owner + full owned set, no *.go owner) passes.
  const pass = evaluateCorrectness({
    taskFamily: "ownership_lookup",
    condition: "with_project_librarian",
    benchmarkTrack: "code_graph",
    expectation,
    finalText: `Under last-match precedence the owner is ${CODEOWNERS_SERVICE_OWNER}, owning ${ownedList} (from CODEOWNERS).`,
    fileChangeCount: 0,
  });
  assert.equal(pass.status, "passed", pass.reason);
});

// --- end-to-end: a real small build passes every A7 assert --------------------

test("a real small fixture build passes the A7 structural asserts in both conditions", { skip }, () => {
  const fixtureRoot = makeTmpDir("a7-build-small-");
  try {
    // materializeFixturePair runs assertCodeStructureBounds on both roots; a
    // structural shortfall would throw here.
    materializeFixturePair(fixtureRoot, "small", cliPath, "organic");
    for (const condition of ["with_project_librarian", "without_project_librarian"]) {
      const root = path.join(fixtureRoot, "small", condition);
      assert.doesNotThrow(() => assertCodeStructureBounds(root, "small"));
      // The named ownership target and the chain root exist on disk.
      assert(fs.existsSync(path.join(root, CODEOWNERS_TARGET_PATH)));
      assert(fs.existsSync(path.join(root, "packages/workspace-0/src/mod-0.ts")));
    }
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
