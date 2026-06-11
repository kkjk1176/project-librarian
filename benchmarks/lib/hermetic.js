"use strict";

// A5 hermetic measurement machinery for the actual-LLM Codex benchmark.
//
// These are the pure, unit-testable pieces that make a measured Codex run
// hermetic so the numbers are not contaminated by user-level plugins, user
// config, or runtime state leaking into fixtures:
//
//   - resolveCodexAuthSource:    locate the real auth material in the user home.
//   - buildIsolatedCodexHome:    a fresh per-run CODEX_HOME containing ONLY auth.
//   - buildSpawnEnv:             an allowlist-only child env (no inherited plugins).
//   - findRuntimeStatePaths:     locate runtime-state dirs/files inside a fixture.
//   - validateFixtureAfterRun:   re-fingerprint + denylist scan; fail on drift.
//
// No-fallback rule: every function throws a clear error on a violation rather
// than degrading to the user home, silently excluding files, or guessing.

const fs = require("node:fs");
const path = require("node:path");

const { fingerprintDirectory } = require("./llm-fixtures");

// The only files copied from the user's real Codex home into the isolated home.
// Discovered from the running codex CLI: auth lives in CODEX_HOME/auth.json (mode
// 0600). Nothing else is copied — no config.toml (which carries the [plugins.*]
// table), no plugins/, no agents/, no *.sqlite state. A fresh home with only
// auth.json authenticates while loading no user plugins or project config.
const CODEX_AUTH_FILE_CANDIDATES = ["auth.json"];

// Runtime-state directories and files that must never appear inside a fixture
// after a measured run. Their presence means isolation failed (codex, a plugin,
// or an OMC/OMX layer wrote runtime state into the sandboxed fixture), which is a
// HARD FAILURE per the wiki rule — not something to silently exclude from the
// fingerprint. Matched by exact basename anywhere under the fixture root.
const RUNTIME_STATE_BASENAMES = [
  ".omx",
  ".omc",
  ".codex",
  ".claude",
  ".gemini",
  ".cursor",
];

// Resolve the real Codex home directory the user authenticated against. Honors an
// explicit CODEX_HOME in the source environment, else ~/.codex. Throws if the
// home does not exist (we must not invent one).
function resolveRealCodexHome(sourceEnv, homeDir) {
  const explicit = sourceEnv && typeof sourceEnv.CODEX_HOME === "string" ? sourceEnv.CODEX_HOME.trim() : "";
  const home = explicit || path.join(homeDir, ".codex");
  if (!fs.existsSync(home) || !fs.statSync(home).isDirectory()) {
    throw new Error(`hermetic measurement requires a real Codex home; not found at ${home}`);
  }
  return home;
}

// Find the auth file inside the real Codex home. Returns its absolute path and
// basename. Throws a clear error naming the home and the searched filenames when
// no auth material is present, so a measured run fails at spawn time rather than
// falling back to an unisolated user home.
function resolveCodexAuthSource(realCodexHome) {
  for (const candidate of CODEX_AUTH_FILE_CANDIDATES) {
    const absolute = path.join(realCodexHome, candidate);
    if (fs.existsSync(absolute) && fs.statSync(absolute).isFile()) {
      return { path: absolute, file: candidate };
    }
  }
  throw new Error(
    `hermetic measurement requires Codex auth material; none of [${CODEX_AUTH_FILE_CANDIDATES.join(", ")}] found in Codex home ${realCodexHome}. ` +
    "Authenticate codex (so auth.json exists) before a measured run; the benchmark must not fall back to the unisolated user home.",
  );
}

// Build a fresh isolated CODEX_HOME at destHome containing ONLY the auth file
// copied from the real Codex home. The destination must not already exist (each
// measured run gets its own home). Copies nothing else — no plugins, no user
// config beyond auth. Preserves the 0600 auth permissions. Returns provenance:
// the isolated home path, the copied file basename, and the real auth source.
function buildIsolatedCodexHome({ realCodexHome, destHome }) {
  if (!destHome || typeof destHome !== "string") {
    throw new Error("buildIsolatedCodexHome requires a destHome path");
  }
  if (fs.existsSync(destHome)) {
    throw new Error(`isolated Codex home destination already exists: ${destHome}`);
  }
  const authSource = resolveCodexAuthSource(realCodexHome);
  fs.mkdirSync(destHome, { recursive: true, mode: 0o700 });
  const destAuth = path.join(destHome, authSource.file);
  fs.copyFileSync(authSource.path, destAuth);
  // auth.json is secret material; keep it owner-only in the isolated home too.
  fs.chmodSync(destAuth, 0o600);
  return {
    codex_home: destHome,
    real_codex_home: realCodexHome,
    auth_source: authSource.path,
    copied_files: [authSource.file],
  };
}

// Build the child-process environment from an explicit allowlist instead of
// inheriting process.env. This drops arbitrary user environment (and therefore
// any plugin/config toggles carried in the environment) while preserving exactly
// what codex strictly needs:
//   - PATH (locate the codex binary and its helpers),
//   - HOME (codex resolves some paths relative to it),
//   - CODEX_HOME (point codex at the isolated home),
//   - locale/TERM basics for stable CLI output,
//   - in api-key mode only, the API key envs (auth-mode contract).
//
// Auth-mode contract (mirrors requireMeasuredAuth in the runner): subscription
// mode (authMode !== "api-key") must NOT forward CODEX_API_KEY / OPENAI_API_KEY;
// api-key mode forwards whichever of them is present. The allowlist is the single
// place that enforces this for the spawned child.
function buildSpawnEnv({ sourceEnv, codexHome, authMode, homeDir }) {
  if (!codexHome || typeof codexHome !== "string") {
    throw new Error("buildSpawnEnv requires the isolated codexHome path");
  }
  const env = {};
  const passthroughKeys = ["PATH", "LANG", "LC_ALL", "LC_CTYPE", "TERM", "TZ", "TMPDIR"];
  for (const key of passthroughKeys) {
    if (sourceEnv && typeof sourceEnv[key] === "string" && sourceEnv[key].length > 0) {
      env[key] = sourceEnv[key];
    }
  }
  // PATH is mandatory: without it the codex binary and the commands it shells out
  // to cannot be located. Fail loudly rather than spawn a crippled child.
  if (!env.PATH) {
    throw new Error("buildSpawnEnv requires PATH in the source environment to locate the codex binary");
  }
  // HOME points at the isolated home's parent expectations; codex resolves the
  // isolated state under CODEX_HOME, but some libraries still read HOME. Use the
  // provided homeDir so nothing reaches into the real user home beyond it.
  if (homeDir) env.HOME = homeDir;
  env.CODEX_HOME = codexHome;

  if (authMode === "api-key") {
    // api-key mode: forward whichever API key envs are present so the child can
    // authenticate with API-key pricing. Subscription mode forwards neither.
    for (const key of ["CODEX_API_KEY", "OPENAI_API_KEY"]) {
      if (sourceEnv && typeof sourceEnv[key] === "string" && sourceEnv[key].length > 0) {
        env[key] = sourceEnv[key];
      }
    }
  }
  return env;
}

// Walk a fixture directory and collect any runtime-state directories/files (by
// exact basename match against RUNTIME_STATE_BASENAMES) anywhere inside it.
// Returns fixture-relative POSIX paths, sorted. .git and node_modules are skipped
// (node_modules is the symlinked runner dependency and .git is provenance), but a
// runtime-state hit is reported even when nested under other directories.
function findRuntimeStatePaths(root) {
  const found = [];
  function visit(directory) {
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      if (RUNTIME_STATE_BASENAMES.includes(entry.name)) {
        found.push(relative);
        // Do not descend into a flagged runtime-state directory; the directory
        // itself is the violation.
        continue;
      }
      if (entry.isDirectory()) {
        if ([".git", "node_modules"].includes(entry.name)) continue;
        visit(absolute);
      }
    }
  }
  visit(root);
  return found;
}

// Snapshot the full set of relative POSIX paths (both files and directories)
// currently present inside a fixture directory. Used to build the pre-run
// baseline so post-run denylist scanning can distinguish paths that already
// existed (legitimate bootstrap output) from paths newly written during the run
// (isolation failure). .git and node_modules are excluded — same as fingerprint.
// Returns a plain Set<string> of relative POSIX paths.
function snapshotFixturePaths(root) {
  const found = new Set();
  function visit(directory) {
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if ([".git", "node_modules"].includes(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      found.add(relative);
      if (entry.isDirectory()) visit(absolute);
    }
  }
  visit(root);
  return found;
}

// Pre-run fixture integrity check. Verifies that the fixture fingerprint matches
// the manifest before spawning codex so a stale or mutated fixture fails BEFORE
// consuming quota. The error message is distinct from the post-run one so the
// two failure modes are unambiguous in logs.
function checkPreRunFingerprint({ cwd, expectedFingerprint }) {
  if (!cwd || !fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
    throw new Error(`pre-run fixture check: fixture directory missing: ${cwd}`);
  }
  if (!expectedFingerprint || typeof expectedFingerprint.value !== "string") {
    throw new Error(`pre-run fixture check: missing expected fingerprint for ${cwd}`);
  }
  const actualFingerprint = fingerprintDirectory(cwd);
  if (actualFingerprint.value !== expectedFingerprint.value || actualFingerprint.file_count !== expectedFingerprint.file_count) {
    throw new Error(
      `pre-run fixture check FAILED: fixture ${cwd} does not match the manifest fingerprint before the run ` +
      `(expected ${expectedFingerprint.file_count} files / ${expectedFingerprint.value.slice(0, 12)}…, ` +
      `got ${actualFingerprint.file_count} files / ${actualFingerprint.value.slice(0, 12)}…). ` +
      "The fixture may be stale or mutated from a previous run. Regenerate the manifest before measuring.",
    );
  }
}

// Post-run fixture validation (A5, throws on violation, no fallback). After a
// measured codex run against a fixture:
//   1. Runtime-state denylist: any RUNTIME_STATE_BASENAMES path that is present
//      AFTER the run but was NOT in the pre-run snapshot is a HARD FAILURE naming
//      the offending new paths. Pre-existing denylist-named paths (e.g. .claude/,
//      .codex/ installed by the Project Librarian bootstrap) are NOT flagged —
//      only paths that appeared during the run are isolation failures. When no
//      preRunSnapshot is provided (legacy/test usage), all denylist paths are
//      flagged unconditionally (old behaviour).
//   2. Fingerprint: re-fingerprint the fixture and compare to the manifest
//      fingerprint. Any difference (count or content hash) fails the run.
// Returns a provenance record describing the clean post-run state on success.
function validateFixtureAfterRun({ cwd, expectedFingerprint, preRunSnapshot }) {
  if (!cwd || !fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
    throw new Error(`post-run fixture validation: fixture directory missing: ${cwd}`);
  }
  const allRuntimeStatePaths = findRuntimeStatePaths(cwd);
  // When a pre-run snapshot is available, only flag denylist paths that are NEW
  // (not present before the spawn). Pre-existing bootstrap dirs (.claude, .codex,
  // .cursor, .gemini) are not violations — only paths written during the run are.
  const newRuntimeStatePaths = preRunSnapshot instanceof Set
    ? allRuntimeStatePaths.filter((p) => !preRunSnapshot.has(p))
    : allRuntimeStatePaths;
  if (newRuntimeStatePaths.length > 0) {
    throw new Error(
      `post-run fixture validation failed: runtime-state paths present inside fixture ${cwd}: ${newRuntimeStatePaths.join(", ")}. ` +
      "Isolation failed (codex/plugins wrote runtime state into the fixture); this is a hard failure, not excluded from the fingerprint.",
    );
  }
  const actualFingerprint = fingerprintDirectory(cwd);
  if (!expectedFingerprint || typeof expectedFingerprint.value !== "string") {
    throw new Error(`post-run fixture validation: missing expected fingerprint for ${cwd}`);
  }
  if (actualFingerprint.value !== expectedFingerprint.value || actualFingerprint.file_count !== expectedFingerprint.file_count) {
    throw new Error(
      `post-run fixture validation failed: fixture ${cwd} changed during the measured run ` +
      `(expected ${expectedFingerprint.file_count} files / ${expectedFingerprint.value.slice(0, 12)}…, ` +
      `got ${actualFingerprint.file_count} files / ${actualFingerprint.value.slice(0, 12)}…).`,
    );
  }
  return {
    status: "clean",
    runtime_state_paths: [],
    fingerprint_matched: true,
    file_count: actualFingerprint.file_count,
  };
}

module.exports = {
  CODEX_AUTH_FILE_CANDIDATES,
  RUNTIME_STATE_BASENAMES,
  buildIsolatedCodexHome,
  buildSpawnEnv,
  checkPreRunFingerprint,
  findRuntimeStatePaths,
  resolveCodexAuthSource,
  resolveRealCodexHome,
  snapshotFixturePaths,
  validateFixtureAfterRun,
};
