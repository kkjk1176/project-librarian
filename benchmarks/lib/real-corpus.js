"use strict";

// Real-repository benchmark track (DEV-ONLY harness). This module builds the
// real-corpus measurement pipeline that combines a SHA-pinned public-OSS corpus
// (codegraph-style realism) with our correctness/claim gates. It is the offline
// counterpart of llm-fixtures.js for synthetic fixtures.
//
// Hard offline contract (enforced by the unit tests, which never go to the
// network): fetchCorpus REFUSES to do anything without an explicit allowFetch
// flag, and the network path is never exercised by tests — only the refusal path
// and the post-fetch verification logic (driven by a local file-copy stub) are
// covered. Materialization, MCP injection, the MCP handshake, key-file validation,
// and fingerprinting are all exercised against a tmp git stub repo.
//
// No-fallback rule (project AGENTS.md): every validator throws a clear, specific
// error on a violation rather than degrading, guessing, or silently excluding.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");

const {
  conditions,
  convertCodeIndexForReadOnlyQuery,
  codeEvidenceRelativeDatabasePath,
  installLocalRunner,
} = require("./llm-fixtures");
const { injectMcpServerConfig, MCP_SERVER_NAME } = require("./hermetic");

// The placeholder SHA allowed in the candidate manifest until corpus-prep pins a
// real commit. fetchCorpus refuses to fetch a candidate still carrying it (you
// cannot shallow-fetch an unpinned commit), so a forgotten pin fails loudly.
const PIN_PLACEHOLDER = "PIN-AT-PREP";

// The task families the real-corpus track measures, reusing the code_graph
// designation semantics from llm-correctness.js. Real-repo questions are
// code-graph only (there is no maintained wiki living inside a fetched OSS repo),
// so the wiki track does not apply and the real corpus is recorded under
// `corpus: real` to keep it separate from synthetic results.
const REAL_TASK_FAMILIES = ["impact_trace", "ownership_lookup", "workspace_graph"];

// Supported parser languages the selection gate counts toward its >=4 requirement.
// Mirrors the languages the product's code-evidence index can parse; kept here so
// the gate validator does not import TypeScript. A candidate language outside this
// set is rejected by assertSelectionGate (a typo or unsupported language must fail
// rather than silently count toward the gate).
const SUPPORTED_PARSER_LANGUAGES = [
  "typescript",
  "javascript",
  "python",
  "go",
  "rust",
  "java",
  "c",
  "cpp",
  "csharp",
  "php",
  "kotlin",
  "swift",
];

// --- candidate manifest + selection gate -------------------------------------

// Load and shape-validate the candidate corpus manifest (benchmarks/real-corpus.json
// by default). Throws on any malformed candidate; the selection gate is asserted
// separately by assertSelectionGate so callers can validate a subset.
function loadCorpusManifest(manifestPath) {
  if (!manifestPath || !fs.existsSync(manifestPath)) {
    throw new Error(`real corpus manifest not found: ${manifestPath}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`real corpus manifest is not valid JSON (${manifestPath}): ${error.message}`);
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.candidates)) {
    throw new Error(`real corpus manifest must be an object with a candidates array: ${manifestPath}`);
  }
  for (const candidate of parsed.candidates) {
    assertCandidateShape(candidate, manifestPath);
  }
  return parsed;
}

function assertCandidateShape(candidate, manifestPath) {
  if (!candidate || typeof candidate !== "object") {
    throw new Error(`real corpus candidate must be an object in ${manifestPath}`);
  }
  const requiredStrings = ["name", "url", "sha", "language"];
  for (const key of requiredStrings) {
    if (typeof candidate[key] !== "string" || candidate[key].length === 0) {
      throw new Error(`real corpus candidate ${candidate.name || "<unnamed>"} is missing string field "${key}"`);
    }
  }
  if (!Number.isInteger(candidate.approx_files) || candidate.approx_files < 0) {
    throw new Error(`real corpus candidate ${candidate.name} has invalid approx_files (expected a non-negative integer)`);
  }
  for (const key of ["has_codeowners", "workspace_monorepo"]) {
    if (typeof candidate[key] !== "boolean") {
      throw new Error(`real corpus candidate ${candidate.name} field "${key}" must be a boolean`);
    }
  }
}

// Selection-gate validator (throws on the FIRST unmet gate, naming it). The corpus
// must clear every gate from the decision log:
//   - >=4 DISTINCT supported parser languages across the corpus,
//   - >=1 repo with approx_files > 5000,
//   - >=2 repos with has_codeowners true,
//   - >=2 workspace monorepos.
// Each candidate language must be a supported parser language (an unsupported
// language fails before it can count). The over-5000 threshold is strict (> 5000).
function assertSelectionGate(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new Error("real corpus selection gate failed: no candidates provided");
  }
  for (const candidate of candidates) {
    if (!SUPPORTED_PARSER_LANGUAGES.includes(candidate.language)) {
      throw new Error(`real corpus selection gate failed: candidate ${candidate.name} language "${candidate.language}" is not a supported parser language [${SUPPORTED_PARSER_LANGUAGES.join(", ")}]`);
    }
  }
  const distinctLanguages = new Set(candidates.map((candidate) => candidate.language));
  if (distinctLanguages.size < 4) {
    throw new Error(`real corpus selection gate failed: only ${distinctLanguages.size} distinct supported parser languages [${[...distinctLanguages].join(", ")}], require >=4`);
  }
  const largeRepoCount = candidates.filter((candidate) => candidate.approx_files > 5000).length;
  if (largeRepoCount < 1) {
    throw new Error(`real corpus selection gate failed: ${largeRepoCount} repos over 5000 approx_files, require >=1`);
  }
  const codeownersCount = candidates.filter((candidate) => candidate.has_codeowners).length;
  if (codeownersCount < 2) {
    throw new Error(`real corpus selection gate failed: ${codeownersCount} repos with real CODEOWNERS, require >=2`);
  }
  const monorepoCount = candidates.filter((candidate) => candidate.workspace_monorepo).length;
  if (monorepoCount < 2) {
    throw new Error(`real corpus selection gate failed: ${monorepoCount} workspace monorepos, require >=2`);
  }
  return {
    distinct_languages: [...distinctLanguages].sort(),
    large_repo_count: largeRepoCount,
    codeowners_count: codeownersCount,
    monorepo_count: monorepoCount,
  };
}

// --- corpus fetch (flag-gated, never run by tests live) ----------------------

// Refuse-or-fetch the corpus. WITHOUT allowFetch (the only path tests exercise),
// it throws an exit-2-style loud refusal LISTING exactly what WOULD be fetched
// (repo + url + pinned sha), so a measured run never silently reaches the network.
// WITH allowFetch, it shallow-fetches each repo at its pinned sha into corpusDir
// and verifies the checkout via verifyFetchedRepo; the live fetch path is NOT
// covered by tests (the post-fetch verification logic is covered via a local
// file-copy stub instead). Candidates still carrying the PIN-AT-PREP placeholder
// are rejected before any fetch is attempted.
function fetchCorpus({ allowFetch = false, corpusDir, candidates }) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new Error("fetchCorpus requires a non-empty candidates array");
  }
  if (!corpusDir || typeof corpusDir !== "string") {
    throw new Error("fetchCorpus requires a corpusDir path");
  }
  if (!allowFetch) {
    const lines = candidates.map((candidate) => `  - ${candidate.name}: ${candidate.url} @ ${candidate.sha}`);
    const error = new Error(
      "real corpus fetch refused: network fetch is OFF by default. Pass --allow-corpus-fetch to fetch the following SHA-pinned repositories (this consumes network and must accompany a measurement approval):\n" +
      `${lines.join("\n")}\n` +
      `Target corpus directory: ${corpusDir}`,
    );
    // exit-2 semantics: a distinct, non-1 code so a wrapper can tell "refused
    // because not allowed" apart from a generic failure.
    error.exitCode = 2;
    error.refused = true;
    throw error;
  }
  for (const candidate of candidates) {
    if (candidate.sha === PIN_PLACEHOLDER) {
      throw new Error(`fetchCorpus: candidate ${candidate.name} still carries the ${PIN_PLACEHOLDER} placeholder sha; pin it to a real commit before fetching`);
    }
  }
  const fetched = [];
  for (const candidate of candidates) {
    const dest = path.join(corpusDir, candidate.name);
    shallowFetchAtSha(candidate, dest);
    verifyFetchedRepo({ repoDir: dest, expectedSha: candidate.sha });
    fetched.push({ name: candidate.name, dir: dest, sha: candidate.sha });
  }
  return { corpus_dir: corpusDir, fetched };
}

// Shallow-fetch a single repo at a pinned sha. NEVER exercised by the offline
// tests (fetchCorpus is flag-gated and the live path is untested). Kept minimal:
// init, add remote, fetch the exact sha at depth 1, checkout. Any git failure
// surfaces with the original error (no fallback to a different ref).
function shallowFetchAtSha(candidate, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const run = (args) => childProcess.execFileSync("git", args, { cwd: dest, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
  run(["init"]);
  run(["remote", "add", "origin", candidate.url]);
  run(["fetch", "--depth", "1", "origin", candidate.sha]);
  run(["checkout", "--detach", "FETCH_HEAD"]);
}

// Post-fetch verification: confirm the checked-out HEAD matches the pinned sha and
// the working tree is clean. THIS LOGIC IS UNIT-TESTED via a local file-copy stub
// (a tmp git repo "fetched" by copying files), so the verification path is covered
// without any network access. Throws on a mismatch or a dirty tree (no fallback).
function verifyFetchedRepo({ repoDir, expectedSha }) {
  if (!repoDir || !fs.existsSync(repoDir)) {
    throw new Error(`verifyFetchedRepo: repo directory missing: ${repoDir}`);
  }
  const head = gitRevParseHead(repoDir);
  if (expectedSha && expectedSha !== PIN_PLACEHOLDER && head !== expectedSha) {
    throw new Error(`verifyFetchedRepo: ${repoDir} HEAD is ${head}, expected pinned sha ${expectedSha}`);
  }
  const status = gitStatusPorcelain(repoDir);
  if (status.length > 0) {
    throw new Error(`verifyFetchedRepo: ${repoDir} working tree is not clean after fetch:\n${status}`);
  }
  return { repo_dir: repoDir, head, clean: true };
}

function gitRevParseHead(repoDir) {
  return childProcess.execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoDir, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" }).trim();
}

function gitStatusPorcelain(repoDir) {
  return childProcess.execFileSync("git", ["status", "--porcelain"], { cwd: repoDir, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" }).trim();
}

// --- answer-key files ---------------------------------------------------------

// Load and STRICTLY validate a per-repo answer-key file. The key shape:
//   { repo, sha, code_scopes?: [string], questions: [
//       { question_id, task_family (impact_trace|ownership_lookup|workspace_graph),
//         prompt, expectation (designation-semantics shape from llm-correctness) } ] }
// Unknown top-level fields, unknown question fields, a missing expectation, an
// unknown task_family, or a malformed expectation all HARD-FAIL (no silent
// tolerance), so a typo in a hand-authored key is caught at load time rather than
// producing a meaningless measurement.
// `notes` is an OPTIONAL free-text provenance field on a key file: the recorded
// anti-circularity decision asks the author to document how each expectation was
// independently derived and to record any index/source reconciliation. It is
// key-level metadata only (never propagated into scenarios or the manifest), so it
// does not affect any downstream consumer; when present it must be a non-empty
// string (validated below), so a malformed notes field still fails loudly.
const KEY_TOP_FIELDS = new Set(["repo", "sha", "code_scopes", "questions", "notes"]);
const KEY_QUESTION_FIELDS = new Set(["question_id", "task_family", "prompt", "expectation"]);
const EXPECTATION_FIELDS = new Set([
  "required_terms",
  "any_terms",
  "forbidden_terms",
  "designation_forbidden",
  "evidence_by_condition",
  "answer_key_terms",
]);

function loadAnswerKey(keyPath) {
  if (!keyPath || !fs.existsSync(keyPath)) {
    throw new Error(`real corpus answer key not found: ${keyPath}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(keyPath, "utf8"));
  } catch (error) {
    throw new Error(`real corpus answer key is not valid JSON (${keyPath}): ${error.message}`);
  }
  validateAnswerKey(parsed, keyPath);
  return parsed;
}

function validateAnswerKey(key, label) {
  if (!key || typeof key !== "object" || Array.isArray(key)) {
    throw new Error(`real corpus answer key must be an object (${label})`);
  }
  for (const field of Object.keys(key)) {
    if (!KEY_TOP_FIELDS.has(field)) {
      throw new Error(`real corpus answer key ${label} has unknown top-level field "${field}"`);
    }
  }
  if (typeof key.repo !== "string" || key.repo.length === 0) {
    throw new Error(`real corpus answer key ${label} is missing string field "repo"`);
  }
  if (typeof key.sha !== "string" || key.sha.length === 0) {
    throw new Error(`real corpus answer key ${label} is missing string field "sha"`);
  }
  if (Object.hasOwn(key, "code_scopes")) {
    if (!Array.isArray(key.code_scopes) || key.code_scopes.some((scope) => typeof scope !== "string" || scope.length === 0)) {
      throw new Error(`real corpus answer key ${label} "code_scopes" must be an array of non-empty strings`);
    }
  }
  if (Object.hasOwn(key, "notes")) {
    if (typeof key.notes !== "string" || key.notes.length === 0) {
      throw new Error(`real corpus answer key ${label} "notes" must be a non-empty string`);
    }
  }
  if (!Array.isArray(key.questions) || key.questions.length === 0) {
    throw new Error(`real corpus answer key ${label} must carry a non-empty "questions" array`);
  }
  const seenIds = new Set();
  for (const question of key.questions) {
    validateKeyQuestion(question, label);
    if (seenIds.has(question.question_id)) {
      throw new Error(`real corpus answer key ${label} has duplicate question_id "${question.question_id}"`);
    }
    seenIds.add(question.question_id);
  }
  return key;
}

function validateKeyQuestion(question, label) {
  if (!question || typeof question !== "object" || Array.isArray(question)) {
    throw new Error(`real corpus answer key ${label} has a non-object question`);
  }
  for (const field of Object.keys(question)) {
    if (!KEY_QUESTION_FIELDS.has(field)) {
      throw new Error(`real corpus answer key ${label} question "${question.question_id || "<unnamed>"}" has unknown field "${field}"`);
    }
  }
  if (typeof question.question_id !== "string" || question.question_id.length === 0) {
    throw new Error(`real corpus answer key ${label} has a question missing "question_id"`);
  }
  if (!REAL_TASK_FAMILIES.includes(question.task_family)) {
    throw new Error(`real corpus answer key ${label} question "${question.question_id}" has unknown task_family "${question.task_family}" (expected one of ${REAL_TASK_FAMILIES.join(", ")})`);
  }
  if (typeof question.prompt !== "string" || question.prompt.length === 0) {
    throw new Error(`real corpus answer key ${label} question "${question.question_id}" is missing string field "prompt"`);
  }
  if (!Object.hasOwn(question, "expectation")) {
    throw new Error(`real corpus answer key ${label} question "${question.question_id}" is missing its "expectation" (required)`);
  }
  validateExpectationShape(question.expectation, `${label} question "${question.question_id}"`);
}

// Validate the designation-semantics expectation shape consumed by
// llm-correctness.evaluateCorrectness. required_terms/forbidden_terms are string
// arrays; any_terms is an array of string-arrays; designation_forbidden (optional)
// is an array of { team, correct_owner }; evidence_by_condition (optional) maps
// each condition to a string array; answer_key_terms (optional) is a string array.
// Unknown expectation fields hard-fail.
function validateExpectationShape(expectation, label) {
  if (!expectation || typeof expectation !== "object" || Array.isArray(expectation)) {
    throw new Error(`real corpus expectation must be an object (${label})`);
  }
  for (const field of Object.keys(expectation)) {
    if (!EXPECTATION_FIELDS.has(field)) {
      throw new Error(`real corpus expectation has unknown field "${field}" (${label})`);
    }
  }
  for (const field of ["required_terms", "forbidden_terms"]) {
    if (!Array.isArray(expectation[field]) || expectation[field].some((term) => typeof term !== "string")) {
      throw new Error(`real corpus expectation "${field}" must be an array of strings (${label})`);
    }
  }
  if (!Array.isArray(expectation.any_terms) || expectation.any_terms.some((group) => !Array.isArray(group) || group.some((term) => typeof term !== "string"))) {
    throw new Error(`real corpus expectation "any_terms" must be an array of string arrays (${label})`);
  }
  if (Object.hasOwn(expectation, "designation_forbidden")) {
    if (!Array.isArray(expectation.designation_forbidden)) {
      throw new Error(`real corpus expectation "designation_forbidden" must be an array (${label})`);
    }
    for (const entry of expectation.designation_forbidden) {
      if (!entry || typeof entry !== "object" || typeof entry.team !== "string" || typeof entry.correct_owner !== "string") {
        throw new Error(`real corpus expectation "designation_forbidden" entries need { team, correct_owner } strings (${label})`);
      }
    }
  }
  if (Object.hasOwn(expectation, "evidence_by_condition")) {
    const ebc = expectation.evidence_by_condition;
    if (!ebc || typeof ebc !== "object" || Array.isArray(ebc)) {
      throw new Error(`real corpus expectation "evidence_by_condition" must be an object keyed by condition (${label})`);
    }
    for (const condition of conditions) {
      if (!Object.hasOwn(ebc, condition)) {
        throw new Error(`real corpus expectation "evidence_by_condition" missing condition "${condition}" (${label})`);
      }
      if (!Array.isArray(ebc[condition]) || ebc[condition].some((term) => typeof term !== "string")) {
        throw new Error(`real corpus expectation "evidence_by_condition.${condition}" must be an array of strings (${label})`);
      }
    }
  }
  // answer_key_terms is REQUIRED for real-corpus expectations: every real-corpus
  // scenario is code_graph, and the code_graph manifest contract (smoke validator)
  // and the docs-only answerability discipline both rely on answer_key_terms. A key
  // missing it would load but produce a manifest that fails the code_graph schema
  // check, so require it here for a single, early, clear failure.
  if (!Array.isArray(expectation.answer_key_terms) || expectation.answer_key_terms.some((term) => typeof term !== "string")) {
    throw new Error(`real corpus expectation "answer_key_terms" must be a (non-missing) array of strings — required for code_graph real-corpus keys (${label})`);
  }
}

// --- per-condition materialization -------------------------------------------

// Copy the pristine corpus clone into a fresh per-condition working directory.
// Never mutates the pristine clone — every condition+run-set gets its own COPY.
// The .git directory is copied too so the post-run `git status --porcelain` clean
// check works against the copy. Throws if the source is missing or the destination
// already exists (each materialization is fresh).
function copyPristineClone(pristineDir, destDir) {
  if (!pristineDir || !fs.existsSync(pristineDir) || !fs.statSync(pristineDir).isDirectory()) {
    throw new Error(`copyPristineClone: pristine corpus directory missing: ${pristineDir}`);
  }
  if (fs.existsSync(destDir)) {
    throw new Error(`copyPristineClone: destination already exists (each condition copy must be fresh): ${destDir}`);
  }
  fs.mkdirSync(path.dirname(destDir), { recursive: true });
  fs.cpSync(pristineDir, destDir, { recursive: true });
}

// In-fixture MCP handshake verification (with-arm). Spawns the installed runner's
// `mcp` stdio server and drives a minimal JSON-RPC handshake — initialize then
// tools/list — over stdin/stdout (newline-delimited), exactly as a real MCP client
// (and the injected Codex config) would. HARD-FAILS if the server does not respond,
// does not identify as project-librarian, or returns no tools. Fully offline (the
// MCP server reads the local code-evidence index, no network). Returns the tool
// names on success.
function verifyMcpHandshake(runnerAbsolutePath, cwd, { timeoutMs = 10000 } = {}) {
  if (!runnerAbsolutePath || !fs.existsSync(runnerAbsolutePath)) {
    throw new Error(`verifyMcpHandshake: installed runner missing: ${runnerAbsolutePath}`);
  }
  const initialize = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "real-corpus-handshake", version: "0" } } };
  const toolsList = { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} };
  const input = `${JSON.stringify(initialize)}\n${JSON.stringify(toolsList)}\n`;
  const result = childProcess.spawnSync(process.execPath, [runnerAbsolutePath, "mcp"], {
    cwd,
    input,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (result.error) {
    throw new Error(`verifyMcpHandshake: MCP server spawn failed: ${result.error.message}`);
  }
  const responses = [];
  for (const line of (result.stdout || "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      responses.push(JSON.parse(trimmed));
    } catch {
      // Ignore non-JSON lines (the server only emits JSON-RPC on stdout; any
      // stray line is not a response).
    }
  }
  // The MCP server names itself from the nearest package.json: the repo-root
  // binary reports "project-librarian", but the runner INSTALLED into a fixture
  // carries a local package.json whose name is "project-librarian-local-runner"
  // (set by installLocalRunner so the CommonJS dist loads under the ESM fixture).
  // Both are legitimate project-librarian server identities, so accept either.
  const acceptedServerNames = new Set([MCP_SERVER_NAME, "project-librarian-local-runner"]);
  const initResponse = responses.find((response) => response.id === 1);
  const serverName = initResponse?.result?.serverInfo?.name;
  if (!initResponse || !initResponse.result || !acceptedServerNames.has(serverName)) {
    throw new Error(`verifyMcpHandshake: initialize did not return a ${MCP_SERVER_NAME} serverInfo (got name ${JSON.stringify(serverName)}; stdout: ${(result.stdout || "").slice(0, 300)}; stderr: ${(result.stderr || "").slice(0, 300)})`);
  }
  const toolsResponse = responses.find((response) => response.id === 2);
  const tools = toolsResponse && toolsResponse.result && Array.isArray(toolsResponse.result.tools) ? toolsResponse.result.tools : null;
  if (!tools || tools.length === 0) {
    throw new Error(`verifyMcpHandshake: tools/list returned no tools (stdout: ${(result.stdout || "").slice(0, 300)})`);
  }
  return { tool_count: tools.length, tool_names: tools.map((tool) => tool.name) };
}

// Materialize the WITH arm from a pristine corpus copy: bootstrap (no git config),
// build + scope the code-evidence index from the key file's code_scopes, install
// the local runner, convert the index out of WAL mode for read-only query, verify
// the installed runner's task commands, AND verify the in-fixture MCP handshake.
// Every step hard-fails on error (no fallback). Returns provenance including the
// installed runner path, the MCP handshake result, and the post-build clean state.
//
// cliPath is the repo's built CLI used to bootstrap/index the copy (the same
// installer the synthetic fixtures use). codeScopes default to the key file's
// code_scopes or, if absent, the conventional packages/package.json/CODEOWNERS set.
function materializeWithArm({ pristineDir, destDir, cliPath, codeScopes }) {
  copyPristineClone(pristineDir, destDir);
  if (!cliPath || !fs.existsSync(cliPath)) {
    throw new Error(`materializeWithArm: built CLI missing (run npm run build): ${cliPath}`);
  }
  const scopes = Array.isArray(codeScopes) && codeScopes.length > 0 ? codeScopes : ["packages", "package.json", "CODEOWNERS"];
  const runCli = (args) => childProcess.execFileSync(process.execPath, [cliPath, ...args], { cwd: destDir, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
  // Bootstrap without touching git config (the copy carries the pristine repo's
  // .git; --no-git-config keeps the bootstrap from rewriting hooks/identity).
  runCli(["--no-git-config"]);
  // Build the code-evidence index scoped to the key file's code_scopes.
  const indexArgs = ["--code-index"];
  for (const scope of scopes) indexArgs.push("--code-scope", scope);
  runCli(indexArgs);
  // Install the local runner so an agent (and the MCP server) can query the index
  // offline, then convert the index out of WAL mode so the read-only query path works.
  const installedCliRelative = installLocalRunner(destDir, cliPath);
  convertCodeIndexForReadOnlyQuery(path.join(destDir, codeEvidenceRelativeDatabasePath()));
  // Verify the installed runner against the freshly indexed REAL repo. Unlike the
  // synthetic verifier (which probes the planted mod-0 import chain), this is a
  // generic check that the index is populated and the task-shaped commands run
  // against an arbitrary repo. Then verify the MCP stdio handshake. Both hard-fail.
  const runnerVerification = verifyRealRunnerCommands(destDir, installedCliRelative);
  const installedCliAbsolute = path.join(destDir, installedCliRelative);
  const mcp = verifyMcpHandshake(installedCliAbsolute, destDir);
  return {
    condition: "with_project_librarian",
    dir: destDir,
    installed_cli: installedCliRelative,
    installed_cli_absolute: installedCliAbsolute,
    code_scopes: scopes,
    runner_verification: runnerVerification,
    mcp_handshake: mcp,
  };
}

// Generic installed-runner verification for a REAL repo. The synthetic
// verifyInstalledRunnerCommands hard-codes the planted mod-0 chain and the
// workspace spine, which do not exist in an arbitrary OSS repo. This instead
// confirms the index is genuinely populated and the shipped task-shaped commands
// execute and return well-formed JSON: a positive indexed file count and an
// executable ownership report (the corpus selection gate guarantees CODEOWNERS in
// the qualifying repos; for a repo without CODEOWNERS the ownership section simply
// returns an empty array, which is still valid JSON and not an error). HARD-FAILS
// on a non-zero file count being absent or on any command erroring.
function verifyRealRunnerCommands(repoDir, installedCliRelative) {
  const installedCli = path.join(repoDir, installedCliRelative);
  const run = (args) => childProcess.execFileSync(process.execPath, [installedCli, ...args], { cwd: repoDir, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
  // 1. The index has indexed files (the bootstrap+index actually populated it).
  const countOutput = run(["--code-query", "SELECT count(*) AS files FROM files"]);
  let countRows;
  try {
    countRows = JSON.parse(countOutput);
  } catch (error) {
    throw new Error(`real runner verification: --code-query did not return JSON: ${error.message}; output: ${countOutput.slice(0, 200)}`);
  }
  if (!Array.isArray(countRows) || countRows.length !== 1 || !Number.isFinite(countRows[0].files) || countRows[0].files <= 0) {
    throw new Error(`real runner verification: index is empty (no indexed files): ${countOutput.slice(0, 200)}`);
  }
  // 2. The ownership report command executes and returns a JSON array (rows when
  //    CODEOWNERS is scoped; an empty array otherwise — both are valid).
  const ownershipOutput = run(["--code-report", "--code-report-section", "ownership"]);
  let ownershipJson;
  try {
    ownershipJson = JSON.parse(ownershipOutput);
  } catch (error) {
    throw new Error(`real runner verification: ownership report did not return JSON: ${error.message}; output: ${ownershipOutput.slice(0, 200)}`);
  }
  if (!Array.isArray(ownershipJson.data)) {
    throw new Error(`real runner verification: ownership report data is not an array: ${ownershipOutput.slice(0, 200)}`);
  }
  return { indexed_files: countRows[0].files, ownership_rows: ownershipJson.data.length };
}

// Materialize the CONTROL arm: a pristine copy, untouched. No bootstrap, no index,
// no runner, no MCP — the control measures the model against the raw repo. The
// only operation is the fresh copy; the pristine clone is never mutated.
function materializeControlArm({ pristineDir, destDir }) {
  copyPristineClone(pristineDir, destDir);
  return { condition: "without_project_librarian", dir: destDir };
}

// --- real-corpus fingerprinting ----------------------------------------------

// Pre-run integrity check for a real-corpus working copy. Unlike the synthetic
// full-file-hash fingerprint (too slow for large repos), this checks the pinned
// SHA (HEAD === expectedSha) and that no TRACKED files are modified. The control
// arm is a pristine copy, so its `git status --porcelain` is fully empty; the
// with arm carries UNTRACKED bootstrap output (.project-wiki/, wiki/, tools/,
// AGENTS.md, the per-agent MCP configs) added during materialization, which is
// legitimate and captured as the pre-run untracked BASELINE — only tracked
// modifications mean the pinned checkout itself was perturbed. Throws on a sha
// mismatch or any tracked-file change BEFORE the run consumes quota. (The post-run
// validator additionally enforces that no NEW untracked runtime-state path appears.)
function checkRealRepoPreRun({ cwd, expectedSha }) {
  if (!cwd || !fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
    throw new Error(`real corpus pre-run check: working copy missing: ${cwd}`);
  }
  const head = gitRevParseHead(cwd);
  if (expectedSha && expectedSha !== PIN_PLACEHOLDER && head !== expectedSha) {
    throw new Error(`real corpus pre-run check FAILED: ${cwd} HEAD ${head} does not match pinned sha ${expectedSha}`);
  }
  // Tracked-modification check only: any porcelain line that is NOT an untracked
  // ("?? ") entry is a modification of a tracked file, which means the pinned
  // checkout is dirty (not just carrying bootstrap output).
  const trackedChanges = gitStatusPorcelain(cwd).split("\n").filter((line) => line.length > 0 && !line.startsWith("?? "));
  if (trackedChanges.length > 0) {
    throw new Error(`real corpus pre-run check FAILED: ${cwd} has tracked-file modifications before the run (the pinned checkout is dirty):\n${trackedChanges.join("\n")}`);
  }
  return { head, clean: true };
}

// Post-run validation for a real-corpus working copy. Two checks:
//   1. `git status --porcelain` must be empty (the run changed no tracked or
//      newly-added file under git). A dirty tree is a HARD FAILURE.
//   2. Runtime-state denylist from git-untracked paths: any new untracked path
//      whose basename is a runtime-state dir (.omx/.omc/.codex/.claude/.gemini/
//      .cursor) that was NOT in the pre-run untracked baseline is a HARD FAILURE
//      (isolation leak). Pre-existing untracked bootstrap dot-dirs in the with-arm
//      copy are captured in the baseline so they are not re-flagged.
// The git-untracked baseline replaces the synthetic path snapshot: for a real repo
// we ask git what is untracked rather than walking the whole tree.
const REAL_RUNTIME_STATE_BASENAMES = [".omx", ".omc", ".codex", ".claude", ".gemini", ".cursor"];

function gitUntrackedPaths(cwd) {
  const output = childProcess.execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
  const untracked = [];
  for (const line of output.split("\n")) {
    if (line.startsWith("?? ")) untracked.push(line.slice(3).trim());
  }
  return untracked;
}

// Snapshot the set of git-untracked paths (and the runtime-state basenames among
// them) BEFORE the run so the post-run denylist scan only flags NEWLY-appeared
// runtime-state paths. For a clean checked-out repo this is empty; for a with-arm
// copy it captures the bootstrap dot-dirs and the installed runner output.
function snapshotRealRepoUntracked(cwd) {
  return new Set(gitUntrackedPaths(cwd));
}

function denylistHitsAmong(paths) {
  return paths.filter((p) => {
    const segments = p.split("/").filter(Boolean);
    return segments.some((segment) => REAL_RUNTIME_STATE_BASENAMES.includes(segment));
  });
}

function validateRealRepoAfterRun({ cwd, expectedSha, preRunUntracked }) {
  if (!cwd || !fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
    throw new Error(`real corpus post-run validation: working copy missing: ${cwd}`);
  }
  // 1. Pinned sha still matches (a run must not move HEAD).
  const head = gitRevParseHead(cwd);
  if (expectedSha && expectedSha !== PIN_PLACEHOLDER && head !== expectedSha) {
    throw new Error(`real corpus post-run validation failed: ${cwd} HEAD ${head} drifted from pinned sha ${expectedSha}`);
  }
  // 2. Tracked-file cleanliness: porcelain (default untracked mode = normal) must
  //    show no tracked modifications. We compute the NEW untracked set separately
  //    so untracked bootstrap output (with-arm) does not, by itself, fail the run.
  const allUntracked = gitUntrackedPaths(cwd);
  const baseline = preRunUntracked instanceof Set ? preRunUntracked : new Set();
  const newUntracked = allUntracked.filter((p) => !baseline.has(p));
  // Tracked-modification check: porcelain with tracked changes only (strip the
  // untracked lines). Any non-untracked porcelain line is a tracked mutation.
  const porcelain = gitStatusPorcelain(cwd);
  const trackedChanges = porcelain.split("\n").map((line) => line).filter((line) => line.length > 0 && !line.startsWith("?? "));
  if (trackedChanges.length > 0) {
    throw new Error(`real corpus post-run validation failed: ${cwd} has tracked-file changes after the run:\n${trackedChanges.join("\n")}`);
  }
  // 3. Runtime-state denylist over NEW untracked paths only.
  const newDenylistHits = denylistHitsAmong(newUntracked);
  if (newDenylistHits.length > 0) {
    throw new Error(`real corpus post-run validation failed: runtime-state paths appeared during the run in ${cwd}: ${newDenylistHits.join(", ")}. Isolation failed (codex/plugins wrote runtime state into the working copy); this is a hard failure.`);
  }
  return {
    status: "clean",
    head,
    pinned_sha_matched: true,
    git_clean: true,
    new_untracked_runtime_state_paths: [],
  };
}

module.exports = {
  PIN_PLACEHOLDER,
  REAL_RUNTIME_STATE_BASENAMES,
  REAL_TASK_FAMILIES,
  SUPPORTED_PARSER_LANGUAGES,
  assertSelectionGate,
  checkRealRepoPreRun,
  copyPristineClone,
  fetchCorpus,
  gitRevParseHead,
  gitStatusPorcelain,
  gitUntrackedPaths,
  loadAnswerKey,
  loadCorpusManifest,
  materializeControlArm,
  materializeWithArm,
  snapshotRealRepoUntracked,
  validateAnswerKey,
  validateExpectationShape,
  validateRealRepoAfterRun,
  verifyFetchedRepo,
  verifyMcpHandshake,
  verifyRealRunnerCommands,
};
