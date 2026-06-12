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

// ownership_lookup designation_forbidden: (a) citing the overridden team in a
// precedence chain must PASS; (b) designating that team as final owner must FAIL.

test("ownership_lookup correctness PASSES when agent cites overridden *.go rule as precedence evidence", () => {
  // An agent that correctly explains last-match-wins will typically QUOTE the
  // overridden *.go rule as part of the evidence chain.  That must not trigger a
  // failure — the rule line has no designation word ("owner"/"owns"/"owned").
  const expectation = codeGraphExpectation("ownership_lookup", "medium");
  const ownedList = expectation.required_terms.slice(1).join(", ");
  // Shape matches all real stage2b agent answers: lists matched rules, declares winner.
  const chainText = [
    `Using CODEOWNERS last-match precedence, ${CODEOWNERS_TARGET_PATH} is owned by \`${CODEOWNERS_SERVICE_OWNER}\`.`,
    ``,
    `Relevant matching rules in order:`,
    `- \`* @benchmark-org-default\``,
    `- \`*.go @go-benchmark-team\``,
    `- \`/packages/workspace-0/ @benchmark-team-0\``,
    `- \`/packages/workspace-0/src/ @benchmark-src-team-0\``,
    `- \`/packages/workspace-0/src/service/ ${CODEOWNERS_SERVICE_OWNER}\` (winning rule)`,
    ``,
    `The winning rule is the last matching rule. Files owned: ${ownedList}.`,
  ].join("\n");
  const pass = evaluateCorrectness({
    taskFamily: "ownership_lookup",
    condition: "with_project_librarian",
    benchmarkTrack: "code_graph",
    expectation,
    finalText: chainText,
    fileChangeCount: 0,
  });
  assert.equal(pass.status, "passed", `expected pass but got: ${JSON.stringify(pass.checks.filter((c) => !c.passed))}`);
});

test("ownership_lookup correctness FAILS when agent designates the *.go team as final owner", () => {
  // An agent that stops at the first *.go match and reports that as the owner is wrong.
  // Even if the correct service owner is mentioned elsewhere, the designation line fails.
  const expectation = codeGraphExpectation("ownership_lookup", "medium");
  const ownedList = expectation.required_terms.slice(1).join(", ");
  // Line 1: designates @go-benchmark-team as owner (has "owns" + forbidden team, no correct owner).
  const wrongText = [
    `@go-benchmark-team owns ${CODEOWNERS_TARGET_PATH} because *.go matches it.`,
    `Note: ${CODEOWNERS_SERVICE_OWNER} also owns some files: ${ownedList}.`,
  ].join("\n");
  const fail = evaluateCorrectness({
    taskFamily: "ownership_lookup",
    condition: "with_project_librarian",
    benchmarkTrack: "code_graph",
    expectation,
    finalText: wrongText,
    fileChangeCount: 0,
  });
  assert.equal(fail.status, "failed");
  const failedCheck = fail.checks.find((c) => c.name === "not designated owner: @go-benchmark-team");
  assert(failedCheck, "expected 'not designated owner' check to exist");
  assert.equal(failedCheck.passed, false);
});

test("ownership_lookup correctness PASSES when correct owner overrides on the same designation line", () => {
  // "*.go @go-benchmark-team BUT @benchmark-service-team wins" on one line: not a wrong designation.
  const expectation = codeGraphExpectation("ownership_lookup", "medium");
  const ownedList = expectation.required_terms.slice(1).join(", ");
  const mixedLine = `@go-benchmark-team owns *.go files but ${CODEOWNERS_SERVICE_OWNER} wins for service/`;
  const passText = [
    mixedLine,
    `Full owned set: ${ownedList}. Source: CODEOWNERS last-match.`,
  ].join("\n");
  const pass = evaluateCorrectness({
    taskFamily: "ownership_lookup",
    condition: "with_project_librarian",
    benchmarkTrack: "code_graph",
    expectation,
    finalText: passText,
    fileChangeCount: 0,
  });
  assert.equal(pass.status, "passed", `expected pass but got: ${JSON.stringify(pass.checks.filter((c) => !c.passed))}`);
});

test("workspace_graph condition evidence check passes on workspace-name-only answers", () => {
  // Agents that answer with @benchmark/workspace-* names (no file paths) must
  // satisfy the condition evidence check — workspace package names ARE code evidence.
  const expectation = codeGraphExpectation("workspace_graph", "small");
  // Replicate the exact shape of a failing stage2b agent answer.
  const workspaceOnlyAnswer = [
    "Highest-numbered workspace package: `@benchmark/workspace-3`.",
    "",
    "Transitive workspace dependency set:",
    "1. `@benchmark/workspace-2`",
    "2. `@benchmark/workspace-1`",
    "3. `@benchmark/workspace-0`",
    "",
    "Evidence chain: @benchmark/workspace-3 depends on @benchmark/workspace-2; ",
    "@benchmark/workspace-2 depends on @benchmark/workspace-1; ",
    "@benchmark/workspace-1 depends on @benchmark/workspace-0.",
  ].join("\n");
  const pass = evaluateCorrectness({
    taskFamily: "workspace_graph",
    condition: "without_project_librarian",
    benchmarkTrack: "code_graph",
    expectation,
    finalText: workspaceOnlyAnswer,
    fileChangeCount: 0,
  });
  assert.equal(pass.status, "passed", `expected pass but got: ${JSON.stringify(pass.checks.filter((c) => !c.passed))}`);
});

// --- FP fixes: real-corpus condition evidence and rule-chain designation -------
//
// FALSE POSITIVE 1: real-corpus condition evidence check
// The synthetic codeGraphEvidenceByCondition tokens (packages/, CODEOWNERS,
// .project-wiki, tools/project-librarian, @benchmark/workspace-) are wrong for
// real repos.  A real-corpus answer key embeds its own evidence_by_condition array
// in the scenario expectation (e.g. ["packages/", "plugins/", "stringifyEntityRef"]
// for backstage/impact-trace).  evaluateCorrectness must use the expectation's
// array verbatim when it is a plain array, not the synthetic fixture constants.

test("FP1: real-corpus with_project_librarian condition evidence uses expectation.evidence_by_condition not synthetic constants", () => {
  // Replicate the backstage impact-trace run-2 shape exactly.
  // The expectation carries a plain-array evidence_by_condition for both conditions
  // (real-corpus answer-key shape); the answer cites "plugins/" + "stringifyEntityRef"
  // but NOT "packages/", ".project-wiki", etc.  Must PASS.
  const expectation = {
    required_terms: [
      "plugins/catalog/src/components/CatalogTable/CatalogTable.tsx",
      "plugins/catalog/src/components/AboutCard/AboutCard.tsx",
    ],
    any_terms: [["import", "call", "depends", "transitive", "uses", "dependent"]],
    forbidden_terms: ["I cannot access", "no such file"],
    evidence_by_condition: {
      with_project_librarian: ["packages/", "plugins/", "stringifyEntityRef"],
      without_project_librarian: ["packages/", "plugins/", "stringifyEntityRef"],
    },
  };
  // Answer cites plugins/ paths (correct for backstage) but not packages/, CODEOWNERS,
  // .project-wiki, tools/project-librarian, @benchmark/workspace- (synthetic constants).
  const realCorpusAnswer = [
    "Using local source evidence only, I found these plugins/catalog* source files",
    "importing or calling stringifyEntityRef from @backstage/catalog-model:",
    "plugins/catalog/src/components/CatalogTable/CatalogTable.tsx",
    "plugins/catalog/src/components/AboutCard/AboutCard.tsx",
    "plugins/catalog-react/src/hooks/useEntityOwnership.ts",
  ].join("\n");
  const result = evaluateCorrectness({
    taskFamily: "impact_trace",
    condition: "with_project_librarian",
    benchmarkTrack: "code_graph",
    expectation,
    finalText: realCorpusAnswer,
    fileChangeCount: 0,
  });
  assert.equal(result.status, "passed", `expected pass but got: ${JSON.stringify(result.checks.filter((c) => !c.passed))}`);
  // The condition evidence check name must reflect the real-corpus terms, not synthetic ones.
  const evidenceCheck = result.checks.find((c) => c.name.startsWith("condition evidence:"));
  assert(evidenceCheck, "condition evidence check must exist");
  assert(evidenceCheck.name.includes("plugins/"), `check name must include real-corpus term 'plugins/', got: ${evidenceCheck.name}`);
  assert(!evidenceCheck.name.includes(".project-wiki"), `check name must NOT include synthetic term '.project-wiki', got: ${evidenceCheck.name}`);
});

test("FP1: synthetic code_graph scenario still uses synthetic codeGraphEvidenceByCondition constants", () => {
  // Ensure the real-corpus fix is additive: a synthetic scenario with no
  // evidence_by_condition array in expectation still uses the track-level map.
  const expectation = codeGraphExpectation("impact_trace", "small");
  // Synthetic expectation has no evidence_by_condition (it uses the shared map).
  // The answer cites "packages/" which satisfies synthetic with_project_librarian evidence.
  const ownedList = expectation.required_terms.slice(0, 2).join(", ");
  const syntheticAnswer = `packages/workspace-0/src/mod-0.ts imports the target symbol.\nDependent files: ${ownedList}.`;
  const result = evaluateCorrectness({
    taskFamily: "impact_trace",
    condition: "with_project_librarian",
    benchmarkTrack: "code_graph",
    expectation,
    finalText: syntheticAnswer,
    fileChangeCount: 0,
  });
  const evidenceCheck = result.checks.find((c) => c.name.startsWith("condition evidence:"));
  assert(evidenceCheck, "condition evidence check must exist");
  assert(evidenceCheck.name.includes(".project-wiki"), `synthetic check name must include '.project-wiki', got: ${evidenceCheck.name}`);
});

// FALSE POSITIVE 2: rule-chain enumeration lines must not count as designations.
// The backstage ownership-lookup run-3 answer showed a precedence chain:
//   "Line 7: `*` matches, owner `@backstage/maintainers`"
//   "Line 33: `/packages` matches, owner `@backstage/framework-maintainers`"
//   "Line 37: `/packages/cli` matches, owner `@backstage/tooling-maintainers`"
// The final designation is correct (@backstage/tooling-maintainers), but the old
// isDesignatedOwner fired on "Line 33" because it contained the forbidden team +
// "owner" signal.  Must PASS.

test("FP2: backstage-style rule-chain enumeration (Line N: ...) does NOT trigger designation check", () => {
  // Exact format from the backstage ownership-lookup run-3 answer.
  const precedenceChainAnswer = [
    "The effective owning team for `packages/cli/src/index.ts` is:",
    "",
    "`@backstage/tooling-maintainers`",
    "",
    "Local CODEOWNERS evidence, in order:",
    "",
    "- Line 7: `*` matches, owner `@backstage/maintainers`",
    "- Line 33: `/packages` matches, owner `@backstage/framework-maintainers`",
    "- Line 37: `/packages/cli` matches, owner `@backstage/tooling-maintainers`",
    "",
    "No later pattern matches `packages/cli/src/index.ts`, so line 37 wins under",
    "GitHub's last-matching-pattern-wins rule.",
  ].join("\n");

  const expectation = {
    required_terms: ["@backstage/tooling-maintainers"],
    any_terms: [["last match", "last-match", "last matching", "precedence", "wins", "CODEOWNERS"]],
    forbidden_terms: ["I cannot access", "no such file"],
    designation_forbidden: [
      { team: "@backstage/framework-maintainers", correct_owner: "@backstage/tooling-maintainers" },
    ],
  };

  const result = evaluateCorrectness({
    taskFamily: "ownership_lookup",
    condition: "with_project_librarian",
    benchmarkTrack: "code_graph",
    expectation,
    finalText: precedenceChainAnswer,
    fileChangeCount: 0,
  });
  assert.equal(result.status, "passed", `expected pass (correct final designation) but got: ${JSON.stringify(result.checks.filter((c) => !c.passed))}`);
  const designationCheck = result.checks.find((c) => c.name === "not designated owner: @backstage/framework-maintainers");
  assert(designationCheck, "designation check must exist");
  assert.equal(designationCheck.passed, true, "Line-N enumeration must not be treated as a wrong final designation");
});

test("FP2: wrong final designation still fails even when correct team appears in chain enumeration", () => {
  // If the agent CONCLUDES with the wrong team, even after citing the correct team
  // as a chain entry, it must FAIL.  The rule-chain exemption must not suppress
  // genuine wrong final designations.
  const wrongFinalAnswer = [
    "The owner of `packages/cli/src/index.ts` is @backstage/framework-maintainers.",
    "",
    "CODEOWNERS evidence:",
    "- Line 37: `/packages/cli` matches, owner `@backstage/tooling-maintainers`",
  ].join("\n");

  const expectation = {
    required_terms: ["@backstage/tooling-maintainers"],
    any_terms: [["last match", "last-match", "last matching", "precedence", "wins", "CODEOWNERS"]],
    forbidden_terms: ["I cannot access", "no such file"],
    designation_forbidden: [
      { team: "@backstage/framework-maintainers", correct_owner: "@backstage/tooling-maintainers" },
    ],
  };

  const result = evaluateCorrectness({
    taskFamily: "ownership_lookup",
    condition: "with_project_librarian",
    benchmarkTrack: "code_graph",
    expectation,
    finalText: wrongFinalAnswer,
    fileChangeCount: 0,
  });
  // The wrong-final-designation line ("The owner of ... is @backstage/framework-maintainers")
  // is NOT a Line-N enumeration, so it must be caught.
  const designationCheck = result.checks.find((c) => c.name === "not designated owner: @backstage/framework-maintainers");
  assert(designationCheck, "designation check must exist");
  assert.equal(designationCheck.passed, false, "Non-enumeration wrong-final-designation line must still fail");
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
