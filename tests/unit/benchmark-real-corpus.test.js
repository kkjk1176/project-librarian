"use strict";

// Real-repository benchmark track unit tests (OFFLINE, tmp-only). These NEVER go
// to the network: fetchCorpus is exercised only on its refusal path, the
// post-fetch verification logic is exercised against a LOCAL git stub repo built
// in tmp (a repo "fetched" by file copy), and materialization / MCP injection /
// MCP handshake / fingerprinting all run against that stub repo. No `codex exec`,
// no networked codex (the MCP handshake spawns the LOCAL installed runner's `mcp`
// stdio server, which reads only the local code-evidence index).

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const cliPath = path.join(root, "dist", "init-project-wiki.js");

const {
  PIN_PLACEHOLDER,
  assertSelectionGate,
  checkRealRepoPreRun,
  copyPristineClone,
  fetchCorpus,
  gitRevParseHead,
  loadAnswerKey,
  loadCorpusManifest,
  materializeControlArm,
  materializeWithArm,
  snapshotRealRepoUntracked,
  validateAnswerKey,
  validateRealRepoAfterRun,
  verifyFetchedRepo,
  verifyMcpHandshake,
} = require("../../benchmarks/lib/real-corpus");
const { buildRealCorpusManifest } = require("../../benchmarks/lib/real-corpus-manifest");
const { buildMcpServerToml, injectMcpServerConfig } = require("../../benchmarks/lib/hermetic");

const skip = !fs.existsSync(cliPath) ? "dist CLI not built (run npm run build)" : false;

function makeTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function git(repoDir, args) {
  return childProcess.execFileSync("git", args, { cwd: repoDir, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
}

// Build a committed git stub repo modeling a small real monorepo: ~10 files, a
// CODEOWNERS with overlapping last-match precedence rules (catch-all, extension,
// workspace dir, and a service override), and TWO workspaces with package.json
// cross-imports (workspace-b depends on workspace-a). Committed so the pinned-sha
// and git-clean checks work. Returns the repo dir and its HEAD sha. This is the
// stub the real-corpus tests "fetch" by copy and materialize from — never the network.
function buildStubRepo(prefix) {
  const repo = makeTmpDir(prefix);
  git(repo, ["init", "-q"]);
  git(repo, ["config", "user.email", "stub@example.com"]);
  git(repo, ["config", "user.name", "Stub"]);
  git(repo, ["config", "commit.gpgsign", "false"]);

  // CODEOWNERS with >=3 overlapping precedence rules (last-match wins): the service
  // override is the last matching rule for the handler path, so a precedence-aware
  // answer reaches @stub-service-team rather than the *.go extension owner.
  writeFile(path.join(repo, "CODEOWNERS"), [
    "* @stub-org-default",
    "*.go @stub-go-team",
    "*.ts @stub-ts-team",
    "/packages/workspace-a/ @stub-team-a",
    "/packages/workspace-a/src/ @stub-src-team",
    "/packages/workspace-a/src/service/ @stub-service-team",
    "",
  ].join("\n"));

  writeFile(path.join(repo, "package.json"), `${JSON.stringify({
    name: "stub-monorepo",
    private: true,
    workspaces: ["packages/*"],
  }, null, 2)}\n`);
  writeFile(path.join(repo, "README.md"), "# Stub monorepo\n\nReal-corpus test stub.\n");

  // workspace-a: an import chain core <- mid <- leaf, plus a service handler.
  writeFile(path.join(repo, "packages", "workspace-a", "package.json"), `${JSON.stringify({
    name: "@stub/workspace-a",
    private: true,
  }, null, 2)}\n`);
  writeFile(path.join(repo, "packages", "workspace-a", "src", "core.ts"), "export function core() { return \"core\"; }\n");
  writeFile(path.join(repo, "packages", "workspace-a", "src", "mid.ts"), "import { core } from \"./core\";\nexport function mid() { return core() + \"-mid\"; }\n");
  writeFile(path.join(repo, "packages", "workspace-a", "src", "leaf.ts"), "import { mid } from \"./mid\";\nexport function leaf() { return mid() + \"-leaf\"; }\n");
  writeFile(path.join(repo, "packages", "workspace-a", "src", "service", "handler.go"), "package service\n\nfunc Handle() string { return \"handler\" }\n");

  // workspace-b depends on workspace-a (package.json edge + import bridge).
  writeFile(path.join(repo, "packages", "workspace-b", "package.json"), `${JSON.stringify({
    name: "@stub/workspace-b",
    private: true,
    dependencies: { "@stub/workspace-a": "workspace:*" },
  }, null, 2)}\n`);
  writeFile(path.join(repo, "packages", "workspace-b", "src", "bridge.ts"), "import { core } from \"@stub/workspace-a/src/core\";\nexport function bridge() { return core(); }\n");

  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "stub monorepo"]);
  const sha = git(repo, ["rev-parse", "HEAD"]).trim();
  return { repo, sha };
}

// --- selection gate -----------------------------------------------------------

test("assertSelectionGate passes for the shipped candidate manifest", () => {
  const manifest = loadCorpusManifest(path.join(root, "benchmarks", "real-corpus.json"));
  const result = assertSelectionGate(manifest.candidates);
  assert(result.distinct_languages.length >= 4, `expected >=4 languages, got ${result.distinct_languages.length}`);
  assert(result.large_repo_count >= 1);
  assert(result.codeowners_count >= 2);
  assert(result.monorepo_count >= 2);
});

test("assertSelectionGate hard-fails naming the unmet gate (too few languages)", () => {
  const candidates = [
    { name: "a", url: "u", sha: "s", language: "typescript", approx_files: 6000, has_codeowners: true, workspace_monorepo: true },
    { name: "b", url: "u", sha: "s", language: "typescript", approx_files: 100, has_codeowners: true, workspace_monorepo: true },
  ];
  assert.throws(() => assertSelectionGate(candidates), /distinct supported parser languages.*require >=4/);
});

test("assertSelectionGate hard-fails naming the unmet gate (no large repo)", () => {
  const candidates = [
    { name: "a", url: "u", sha: "s", language: "typescript", approx_files: 100, has_codeowners: true, workspace_monorepo: true },
    { name: "b", url: "u", sha: "s", language: "python", approx_files: 100, has_codeowners: true, workspace_monorepo: true },
    { name: "c", url: "u", sha: "s", language: "go", approx_files: 100, has_codeowners: false, workspace_monorepo: false },
    { name: "d", url: "u", sha: "s", language: "rust", approx_files: 100, has_codeowners: false, workspace_monorepo: false },
  ];
  assert.throws(() => assertSelectionGate(candidates), /over 5000 approx_files, require >=1/);
});

test("assertSelectionGate hard-fails naming the unmet gate (too few CODEOWNERS / monorepos)", () => {
  const base = [
    { name: "a", url: "u", sha: "s", language: "typescript", approx_files: 6000, has_codeowners: true, workspace_monorepo: true },
    { name: "b", url: "u", sha: "s", language: "python", approx_files: 100, has_codeowners: false, workspace_monorepo: false },
    { name: "c", url: "u", sha: "s", language: "go", approx_files: 100, has_codeowners: false, workspace_monorepo: false },
    { name: "d", url: "u", sha: "s", language: "rust", approx_files: 100, has_codeowners: false, workspace_monorepo: false },
  ];
  assert.throws(() => assertSelectionGate(base), /with real CODEOWNERS, require >=2/);
  const oneOwnerTwoNeeded = base.map((c, i) => (i === 1 ? { ...c, has_codeowners: true } : c));
  assert.throws(() => assertSelectionGate(oneOwnerTwoNeeded), /workspace monorepos, require >=2/);
});

test("assertSelectionGate rejects an unsupported language", () => {
  const candidates = [
    { name: "a", url: "u", sha: "s", language: "cobol", approx_files: 6000, has_codeowners: true, workspace_monorepo: true },
  ];
  assert.throws(() => assertSelectionGate(candidates), /is not a supported parser language/);
});

// --- fetch refusal + post-fetch verification (stub, no network) ---------------

test("fetchCorpus REFUSES without allowFetch and lists what WOULD be fetched (exit-2)", () => {
  const candidates = [
    { name: "vscode", url: "https://example/vscode.git", sha: "abc123", language: "typescript", approx_files: 9000, has_codeowners: false, workspace_monorepo: true },
  ];
  let thrown = null;
  try {
    fetchCorpus({ allowFetch: false, corpusDir: "/tmp/corpus", candidates });
  } catch (error) {
    thrown = error;
  }
  assert(thrown, "fetchCorpus must refuse without allowFetch");
  assert.equal(thrown.exitCode, 2);
  assert.equal(thrown.refused, true);
  assert(thrown.message.includes("network fetch is OFF by default"));
  // It lists exactly what would be fetched: repo + url + pinned sha.
  assert(thrown.message.includes("vscode") && thrown.message.includes("https://example/vscode.git") && thrown.message.includes("abc123"));
});

test("verifyFetchedRepo passes on a clean stub checkout at the pinned sha", () => {
  const { repo, sha } = buildStubRepo("rc-verify-pass-");
  try {
    const result = verifyFetchedRepo({ repoDir: repo, expectedSha: sha });
    assert.equal(result.head, sha);
    assert.equal(result.clean, true);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("verifyFetchedRepo HARD-FAILS on a sha mismatch", () => {
  const { repo } = buildStubRepo("rc-verify-sha-");
  try {
    assert.throws(
      () => verifyFetchedRepo({ repoDir: repo, expectedSha: "0".repeat(40) }),
      /HEAD is .* expected pinned sha/,
    );
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("verifyFetchedRepo HARD-FAILS on a dirty working tree", () => {
  const { repo, sha } = buildStubRepo("rc-verify-dirty-");
  try {
    writeFile(path.join(repo, "README.md"), "# dirtied\n");
    assert.throws(
      () => verifyFetchedRepo({ repoDir: repo, expectedSha: sha }),
      /working tree is not clean after fetch/,
    );
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// --- answer-key shape validation ---------------------------------------------

test("loadAnswerKey accepts the shipped stub example key", () => {
  const key = loadAnswerKey(path.join(root, "benchmarks", "real-keys", "_stub-example.json"));
  assert.equal(key.repo, "_stub-example");
  assert(Array.isArray(key.questions) && key.questions.length >= 1);
  for (const question of key.questions) {
    assert(["impact_trace", "ownership_lookup", "workspace_graph"].includes(question.task_family));
    assert(question.expectation && Array.isArray(question.expectation.required_terms));
  }
});

test("validateAnswerKey hard-fails on an unknown top-level field", () => {
  const key = { repo: "r", sha: "s", questions: [{ question_id: "q1", task_family: "impact_trace", prompt: "p", expectation: { required_terms: [], any_terms: [], forbidden_terms: [] } }], extra: 1 };
  assert.throws(() => validateAnswerKey(key, "test"), /unknown top-level field "extra"/);
});

test("validateAnswerKey hard-fails on an unknown question field", () => {
  const key = { repo: "r", sha: "s", questions: [{ question_id: "q1", task_family: "impact_trace", prompt: "p", expectation: { required_terms: [], any_terms: [], forbidden_terms: [] }, bogus: true }] };
  assert.throws(() => validateAnswerKey(key, "test"), /unknown field "bogus"/);
});

test("validateAnswerKey hard-fails on a missing expectation", () => {
  const key = { repo: "r", sha: "s", questions: [{ question_id: "q1", task_family: "impact_trace", prompt: "p" }] };
  assert.throws(() => validateAnswerKey(key, "test"), /missing its "expectation"/);
});

test("validateAnswerKey hard-fails on an unknown task_family", () => {
  const key = { repo: "r", sha: "s", questions: [{ question_id: "q1", task_family: "mystery", prompt: "p", expectation: { required_terms: [], any_terms: [], forbidden_terms: [] } }] };
  assert.throws(() => validateAnswerKey(key, "test"), /unknown task_family "mystery"/);
});

test("validateAnswerKey hard-fails on a malformed expectation (bad any_terms / unknown field)", () => {
  const badAny = { repo: "r", sha: "s", questions: [{ question_id: "q1", task_family: "impact_trace", prompt: "p", expectation: { required_terms: [], any_terms: ["flat"], forbidden_terms: [] } }] };
  assert.throws(() => validateAnswerKey(badAny, "test"), /"any_terms" must be an array of string arrays/);
  const unknownField = { repo: "r", sha: "s", questions: [{ question_id: "q1", task_family: "impact_trace", prompt: "p", expectation: { required_terms: [], any_terms: [], forbidden_terms: [], surprise: 1 } }] };
  assert.throws(() => validateAnswerKey(unknownField, "test"), /unknown field "surprise"/);
});

test("validateAnswerKey hard-fails on duplicate question_id", () => {
  const expectation = { required_terms: [], any_terms: [], forbidden_terms: [], answer_key_terms: [] };
  const dup = { repo: "r", sha: "s", questions: [
    { question_id: "q1", task_family: "impact_trace", prompt: "p", expectation },
    { question_id: "q1", task_family: "ownership_lookup", prompt: "p2", expectation },
  ] };
  assert.throws(() => validateAnswerKey(dup, "test"), /duplicate question_id "q1"/);
});

test("validateAnswerKey hard-fails when answer_key_terms is missing (required for code_graph keys)", () => {
  const key = { repo: "r", sha: "s", questions: [{ question_id: "q1", task_family: "impact_trace", prompt: "p", expectation: { required_terms: [], any_terms: [], forbidden_terms: [] } }] };
  assert.throws(() => validateAnswerKey(key, "test"), /"answer_key_terms" must be a \(non-missing\) array of strings/);
});

// --- per-condition copy isolation --------------------------------------------

test("copyPristineClone makes an isolated copy; mutating the copy leaves the pristine untouched", () => {
  const { repo } = buildStubRepo("rc-copy-iso-");
  const work = makeTmpDir("rc-copy-work-");
  try {
    const dest = path.join(work, "copy");
    copyPristineClone(repo, dest);
    const pristineReadme = fs.readFileSync(path.join(repo, "README.md"), "utf8");
    // Mutate the copy.
    writeFile(path.join(dest, "README.md"), "# mutated copy\n");
    writeFile(path.join(dest, "new-file.txt"), "new\n");
    // The pristine is untouched.
    assert.equal(fs.readFileSync(path.join(repo, "README.md"), "utf8"), pristineReadme);
    assert.equal(fs.existsSync(path.join(repo, "new-file.txt")), false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(work, { recursive: true, force: true });
  }
});

test("copyPristineClone refuses to overwrite an existing destination", () => {
  const { repo } = buildStubRepo("rc-copy-exists-");
  const work = makeTmpDir("rc-copy-exists-work-");
  try {
    const dest = path.join(work, "copy");
    fs.mkdirSync(dest, { recursive: true });
    assert.throws(() => copyPristineClone(repo, dest), /destination already exists/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(work, { recursive: true, force: true });
  }
});

// --- with-arm materialization incl. MCP handshake ----------------------------

test("materializeWithArm bootstraps+indexes+installs the runner and the MCP handshake succeeds", { skip }, () => {
  const { repo } = buildStubRepo("rc-with-arm-");
  const work = makeTmpDir("rc-with-arm-work-");
  try {
    const withArm = materializeWithArm({
      pristineDir: repo,
      destDir: path.join(work, "with_project_librarian"),
      cliPath,
      codeScopes: ["packages", "package.json", "CODEOWNERS"],
    });
    assert.equal(withArm.condition, "with_project_librarian");
    // The installed runner exists in the copy.
    assert(fs.existsSync(withArm.installed_cli_absolute), "installed runner must exist in the with-arm copy");
    // The MCP handshake returned the project-librarian tools.
    assert(withArm.mcp_handshake.tool_count > 0, "MCP handshake must list tools");
    assert(withArm.mcp_handshake.tool_names.includes("code_impact"), `expected code_impact tool, got ${JSON.stringify(withArm.mcp_handshake.tool_names)}`);
    // The pristine repo was NOT mutated (no .project-wiki, no tools/ runner in it).
    assert.equal(fs.existsSync(path.join(repo, ".project-wiki")), false, "pristine must not gain a code-evidence index");
    assert.equal(fs.existsSync(path.join(repo, "tools", "project-librarian")), false, "pristine must not gain the installed runner");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(work, { recursive: true, force: true });
  }
});

test("materializeControlArm leaves a pristine copy with no bootstrap/index/runner/MCP", () => {
  const { repo } = buildStubRepo("rc-control-arm-");
  const work = makeTmpDir("rc-control-arm-work-");
  try {
    const controlArm = materializeControlArm({ pristineDir: repo, destDir: path.join(work, "without_project_librarian") });
    assert.equal(controlArm.condition, "without_project_librarian");
    // No product artifacts in the control copy.
    assert.equal(fs.existsSync(path.join(controlArm.dir, ".project-wiki")), false);
    assert.equal(fs.existsSync(path.join(controlArm.dir, "tools", "project-librarian")), false);
    assert.equal(fs.existsSync(path.join(controlArm.dir, "wiki")), false);
    // The control copy is identical content to the pristine for tracked files.
    assert.equal(fs.readFileSync(path.join(controlArm.dir, "CODEOWNERS"), "utf8"), fs.readFileSync(path.join(repo, "CODEOWNERS"), "utf8"));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(work, { recursive: true, force: true });
  }
});

test("verifyMcpHandshake HARD-FAILS when pointed at a non-MCP script", () => {
  const work = makeTmpDir("rc-mcp-fail-");
  try {
    // A fake runner that emits nothing useful on stdout.
    const fake = path.join(work, "fake-runner.js");
    writeFile(fake, "#!/usr/bin/env node\n'use strict';\nprocess.stdout.write('not jsonrpc\\n');\n");
    assert.throws(
      () => verifyMcpHandshake(fake, work, { timeoutMs: 4000 }),
      /initialize did not return a project-librarian serverInfo/,
    );
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
});

// --- config.toml MCP injection: content + auth preservation + control absence -

test("injectMcpServerConfig writes the exact [mcp_servers.<name>] table codex emits", () => {
  const home = makeTmpDir("rc-inject-content-");
  try {
    const prov = injectMcpServerConfig({ codexHome: home, runnerPath: "/abs/runner/dist/init-project-wiki.js" });
    assert.equal(prov.created, true);
    assert.equal(prov.command, "node");
    assert.deepEqual(prov.args, ["/abs/runner/dist/init-project-wiki.js", "mcp"]);
    const toml = fs.readFileSync(prov.config_path, "utf8");
    assert.equal(
      toml,
      "[mcp_servers.project-librarian]\ncommand = \"node\"\nargs = [\"/abs/runner/dist/init-project-wiki.js\", \"mcp\"]\n",
    );
    // The rendered block matches buildMcpServerToml (single source of truth).
    assert.equal(toml, buildMcpServerToml({ name: "project-librarian", command: "node", args: ["/abs/runner/dist/init-project-wiki.js", "mcp"] }));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("injectMcpServerConfig APPENDS without clobbering pre-existing config (auth.json untouched)", () => {
  const home = makeTmpDir("rc-inject-append-");
  try {
    // The isolated home already has auth.json (copied by the hermetic builder) and
    // a pre-existing config body. Injection must preserve both.
    writeFile(path.join(home, "auth.json"), JSON.stringify({ tokens: { access_token: "secret" } }));
    writeFile(path.join(home, "config.toml"), "model = \"gpt-5.5\"\n");
    const prov = injectMcpServerConfig({ codexHome: home, runnerPath: "/abs/runner.js" });
    assert.equal(prov.appended, true);
    const toml = fs.readFileSync(prov.config_path, "utf8");
    // Pre-existing body preserved AND the MCP table appended.
    assert(toml.startsWith("model = \"gpt-5.5\"\n"), "pre-existing config body must be preserved");
    assert(toml.includes("[mcp_servers.project-librarian]"), "MCP table must be appended");
    // auth.json is untouched.
    assert.equal(fs.readFileSync(path.join(home, "auth.json"), "utf8"), JSON.stringify({ tokens: { access_token: "secret" } }));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("injectMcpServerConfig refuses to register the same server twice", () => {
  const home = makeTmpDir("rc-inject-dup-");
  try {
    injectMcpServerConfig({ codexHome: home, runnerPath: "/abs/runner.js" });
    assert.throws(
      () => injectMcpServerConfig({ codexHome: home, runnerPath: "/abs/runner.js" }),
      /already present .* refusing to register the MCP server twice/,
    );
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("the control arm gets NO MCP config entry (asymmetry is the with/without contrast)", () => {
  // The control-arm home is a plain isolated home with no injection call; assert no
  // config.toml MCP entry exists. (The runner only calls injectMcpServerConfig for
  // mcp:true with-arm scenarios; this models the control home.)
  const home = makeTmpDir("rc-control-home-");
  try {
    writeFile(path.join(home, "auth.json"), JSON.stringify({ tokens: {} }));
    // No injection — the control home has no config.toml at all.
    assert.equal(fs.existsSync(path.join(home, "config.toml")), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

// --- sha/git-clean fingerprint: pass + drift-fail -----------------------------

test("checkRealRepoPreRun passes on a clean stub at the pinned sha", () => {
  const { repo, sha } = buildStubRepo("rc-prerun-pass-");
  try {
    const result = checkRealRepoPreRun({ cwd: repo, expectedSha: sha });
    assert.equal(result.head, sha);
    assert.equal(result.clean, true);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("checkRealRepoPreRun HARD-FAILS on a TRACKED-file modification before the run", () => {
  const { repo, sha } = buildStubRepo("rc-prerun-dirty-");
  try {
    // README.md is a tracked file in the committed stub; modifying it dirties the
    // pinned checkout.
    writeFile(path.join(repo, "README.md"), "# pre-run dirt\n");
    assert.throws(() => checkRealRepoPreRun({ cwd: repo, expectedSha: sha }), /tracked-file modifications before the run/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("checkRealRepoPreRun PASSES when only UNTRACKED bootstrap output is present (with-arm)", () => {
  // The with-arm copy carries untracked bootstrap output (.project-wiki/, wiki/,
  // tools/, AGENTS.md) BEFORE the measured run; that must not fail the pre-run
  // check — only a tracked modification means the pinned checkout is dirty.
  const { repo, sha } = buildStubRepo("rc-prerun-bootstrap-");
  try {
    writeFile(path.join(repo, ".project-wiki", "code-evidence.sqlite"), "binary");
    writeFile(path.join(repo, "wiki", "startup.md"), "# Startup\n");
    writeFile(path.join(repo, "AGENTS.md"), "# Agents\n");
    const result = checkRealRepoPreRun({ cwd: repo, expectedSha: sha });
    assert.equal(result.head, sha);
    assert.equal(result.clean, true);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("checkRealRepoPreRun HARD-FAILS when HEAD drifted from the pinned sha", () => {
  const { repo } = buildStubRepo("rc-prerun-sha-");
  try {
    assert.throws(() => checkRealRepoPreRun({ cwd: repo, expectedSha: "0".repeat(40) }), /does not match pinned sha/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("validateRealRepoAfterRun PASSES on a clean unchanged copy (sha + git-clean)", () => {
  const { repo, sha } = buildStubRepo("rc-postrun-pass-");
  try {
    const preRunUntracked = snapshotRealRepoUntracked(repo);
    const result = validateRealRepoAfterRun({ cwd: repo, expectedSha: sha, preRunUntracked });
    assert.equal(result.status, "clean");
    assert.equal(result.pinned_sha_matched, true);
    assert.equal(result.git_clean, true);
    assert.deepEqual(result.new_untracked_runtime_state_paths, []);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("validateRealRepoAfterRun HARD-FAILS when the run modified a tracked file (drift)", () => {
  const { repo, sha } = buildStubRepo("rc-postrun-drift-");
  try {
    const preRunUntracked = snapshotRealRepoUntracked(repo);
    // Simulate the run mutating a tracked file.
    writeFile(path.join(repo, "README.md"), "# changed during run\n");
    assert.throws(
      () => validateRealRepoAfterRun({ cwd: repo, expectedSha: sha, preRunUntracked }),
      /has tracked-file changes after the run/,
    );
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("validateRealRepoAfterRun HARD-FAILS when a NEW runtime-state dir appears (.omx), naming it", () => {
  const { repo, sha } = buildStubRepo("rc-postrun-omx-");
  try {
    const preRunUntracked = snapshotRealRepoUntracked(repo);
    // Simulate codex/plugins leaking runtime state into the working copy.
    writeFile(path.join(repo, ".omx", "state", "x"), "session-state");
    assert.throws(
      () => validateRealRepoAfterRun({ cwd: repo, expectedSha: sha, preRunUntracked }),
      (error) => error.message.includes("runtime-state paths appeared during the run") && error.message.includes(".omx"),
    );
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("validateRealRepoAfterRun does NOT flag a PRE-EXISTING untracked runtime-state path (with-arm bootstrap)", () => {
  // A with-arm copy may carry untracked bootstrap dot-dirs BEFORE the run; those are
  // captured in the pre-run baseline and must not be re-flagged post-run.
  const { repo, sha } = buildStubRepo("rc-postrun-prebootstrap-");
  try {
    writeFile(path.join(repo, ".codex", "hooks.json"), "{}\n");
    const preRunUntracked = snapshotRealRepoUntracked(repo);
    // No new runtime state after the run; the pre-existing .codex is in the baseline.
    const result = validateRealRepoAfterRun({ cwd: repo, expectedSha: sha, preRunUntracked });
    assert.equal(result.status, "clean");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// --- end-to-end real manifest build (offline, MCP handshake + injection ready) -

test("buildRealCorpusManifest builds a corpus 'real' manifest with mcp:true with-arm scenarios and pinned-sha fingerprints", { skip }, () => {
  const { repo, sha } = buildStubRepo("rc-manifest-");
  const corpusDir = makeTmpDir("rc-manifest-corpus-");
  const keysDir = makeTmpDir("rc-manifest-keys-");
  const work = makeTmpDir("rc-manifest-work-");
  try {
    // Stage the pristine clone under the corpus dir as "stub".
    copyPristineClone(repo, path.join(corpusDir, "stub"));
    // Author a minimal answer key for the stub repo.
    const key = {
      repo: "stub",
      sha,
      code_scopes: ["packages", "package.json", "CODEOWNERS"],
      questions: [
        {
          question_id: "impact-1",
          task_family: "impact_trace",
          prompt: "Transitive importers of packages/workspace-a/src/core.ts?",
          expectation: {
            required_terms: ["packages/workspace-a/src/mid.ts", "packages/workspace-a/src/leaf.ts"],
            any_terms: [["import", "transitive"]],
            forbidden_terms: ["I cannot access"],
            evidence_by_condition: {
              with_project_librarian: ["packages/", "@stub/workspace-"],
              without_project_librarian: ["packages/", "@stub/workspace-"],
            },
            answer_key_terms: ["packages/workspace-a/src/mid.ts"],
          },
        },
      ],
    };
    writeFile(path.join(keysDir, "stub.json"), `${JSON.stringify(key, null, 2)}\n`);

    const manifest = buildRealCorpusManifest({ corpusDir, keysDir, workDir: work, cliPath, repos: ["stub"] });
    assert.equal(manifest.schema_version, 5);
    assert.equal(manifest.corpus, "real");
    assert.equal(manifest.benchmark_kind, "codex-actual-llm-manifest");
    // One question x two conditions = two scenarios.
    assert.equal(manifest.scenarios.length, 2);
    const withScenario = manifest.scenarios.find((s) => s.condition === "with_project_librarian");
    const controlScenario = manifest.scenarios.find((s) => s.condition === "without_project_librarian");
    // Corpus dimension fields populated.
    for (const scenario of manifest.scenarios) {
      assert.equal(scenario.corpus, "real");
      assert.equal(scenario.repo, "stub");
      assert.equal(scenario.repo_sha, sha);
      assert.equal(scenario.question_id, "impact-1");
      assert.equal(scenario.benchmark_track, "code_graph");
      assert.equal(scenario.fixture_fingerprint.algorithm, "pinned-sha-git-clean");
      assert.equal(scenario.fixture_fingerprint.repo_sha, sha);
    }
    // MCP is marked on the with arm only, with a runner path; the control has none.
    assert.equal(withScenario.mcp, true);
    assert(withScenario.mcp_runner_path && fs.existsSync(withScenario.mcp_runner_path));
    assert.equal(controlScenario.mcp, false);
    assert.equal(controlScenario.mcp_runner_path, null);
    // The repo provenance records the MCP handshake result.
    assert(Array.isArray(manifest.repos) && manifest.repos.length === 1);
    assert(manifest.repos[0].mcp_handshake.tool_count > 0);
    // The pristine clone under corpusDir was not mutated (the work copies are separate).
    assert.equal(fs.existsSync(path.join(corpusDir, "stub", ".project-wiki")), false);
  } finally {
    for (const dir of [repo, corpusDir, keysDir, work]) fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- the candidate manifest's placeholder sha is recognized -------------------

test("PIN_PLACEHOLDER candidates are refused by fetchCorpus even WITH allowFetch", () => {
  const candidates = [
    { name: "vscode", url: "https://example/vscode.git", sha: PIN_PLACEHOLDER, language: "typescript", approx_files: 9000, has_codeowners: false, workspace_monorepo: true },
  ];
  // allowFetch true, but the placeholder sha must block the fetch BEFORE any network
  // op (this is the only allowFetch:true path the tests exercise, and it throws
  // before touching git/network).
  assert.throws(
    () => fetchCorpus({ allowFetch: true, corpusDir: makeTmpDir("rc-pin-"), candidates }),
    new RegExp(`still carries the ${PIN_PLACEHOLDER} placeholder sha`),
  );
});
