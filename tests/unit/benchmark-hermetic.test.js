"use strict";

// A5 hermetic measurement unit tests. These exercise the pure pieces only and
// NEVER execute real codex: an isolated-home builder fed a fake auth file in tmp,
// an env allowlist builder fed a synthetic source env, and the post-run fixture
// validator fed hand-built tmp fixture trees. The integration-style test stubs
// the codex spawn with a fake executable script created inside tmp; it is never
// named "codex" on PATH outside the test's own spawn call.

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
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
} = require("../../benchmarks/lib/hermetic");
const { fingerprintDirectory } = require("../../benchmarks/lib/llm-fixtures");

function makeTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

// Build a fake Codex home in tmp containing an auth.json plus decoy files that
// must NOT be copied (config.toml carries the [plugins.*] table; plugins/ is a
// user plugin dir). Returns the home path.
function makeFakeCodexHome(prefix, { withAuth = true } = {}) {
  const home = makeTmpDir(prefix);
  if (withAuth) writeFile(path.join(home, "auth.json"), JSON.stringify({ tokens: { access_token: "fake" } }));
  writeFile(path.join(home, "config.toml"), "model = \"gpt-5.5\"\n[plugins.\"x@y\"]\n");
  writeFile(path.join(home, "plugins", "ngs-analysis", ".codex-plugin", "plugin.json"), "{}\n");
  writeFile(path.join(home, "state_5.sqlite"), "binary-state");
  return home;
}

// --- isolated-home builder ---------------------------------------------------

test("CODEX_AUTH_FILE_CANDIDATES is auth.json (discovered codex auth filename)", () => {
  assert.deepEqual(CODEX_AUTH_FILE_CANDIDATES, ["auth.json"]);
});

test("buildIsolatedCodexHome copies ONLY auth material, nothing else", () => {
  const realHome = makeFakeCodexHome("herm-auth-real-");
  const parent = makeTmpDir("herm-auth-dest-");
  const destHome = path.join(parent, "codex-home");
  try {
    const isolation = buildIsolatedCodexHome({ realCodexHome: realHome, destHome });
    // The isolated home contains exactly auth.json and nothing copied from the
    // user home (no config.toml, no plugins/, no *.sqlite state).
    const entries = fs.readdirSync(destHome).sort();
    assert.deepEqual(entries, ["auth.json"], `isolated home should contain only auth.json, got ${JSON.stringify(entries)}`);
    assert.equal(isolation.codex_home, destHome);
    assert.equal(isolation.real_codex_home, realHome);
    assert.equal(isolation.auth_source, path.join(realHome, "auth.json"));
    assert.deepEqual(isolation.copied_files, ["auth.json"]);
    // Auth content is preserved and the file is owner-only (0600).
    assert.equal(fs.readFileSync(path.join(destHome, "auth.json"), "utf8"), fs.readFileSync(path.join(realHome, "auth.json"), "utf8"));
    assert.equal(fs.statSync(path.join(destHome, "auth.json")).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(realHome, { recursive: true, force: true });
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("buildIsolatedCodexHome fails when auth material is absent (no fallback)", () => {
  const realHome = makeFakeCodexHome("herm-noauth-real-", { withAuth: false });
  const parent = makeTmpDir("herm-noauth-dest-");
  const destHome = path.join(parent, "codex-home");
  try {
    assert.throws(
      () => buildIsolatedCodexHome({ realCodexHome: realHome, destHome }),
      (error) => error.message.includes("requires Codex auth material") && error.message.includes("auth.json"),
    );
    // Nothing must have been created at the destination on failure.
    assert.equal(fs.existsSync(destHome), false);
  } finally {
    fs.rmSync(realHome, { recursive: true, force: true });
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("buildIsolatedCodexHome refuses to overwrite an existing destination home", () => {
  const realHome = makeFakeCodexHome("herm-exists-real-");
  const parent = makeTmpDir("herm-exists-dest-");
  const destHome = path.join(parent, "codex-home");
  fs.mkdirSync(destHome, { recursive: true });
  try {
    assert.throws(
      () => buildIsolatedCodexHome({ realCodexHome: realHome, destHome }),
      /isolated Codex home destination already exists/,
    );
  } finally {
    fs.rmSync(realHome, { recursive: true, force: true });
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("resolveCodexAuthSource throws when the home has no auth file", () => {
  const realHome = makeFakeCodexHome("herm-resolve-noauth-", { withAuth: false });
  try {
    assert.throws(() => resolveCodexAuthSource(realHome), /requires Codex auth material/);
  } finally {
    fs.rmSync(realHome, { recursive: true, force: true });
  }
});

test("resolveRealCodexHome honors an explicit CODEX_HOME and rejects a missing one", () => {
  const realHome = makeFakeCodexHome("herm-resolvehome-");
  try {
    assert.equal(resolveRealCodexHome({ CODEX_HOME: realHome }, "/nonexistent-home"), realHome);
    assert.throws(
      () => resolveRealCodexHome({ CODEX_HOME: path.join(realHome, "does-not-exist") }, "/nonexistent-home"),
      /requires a real Codex home/,
    );
  } finally {
    fs.rmSync(realHome, { recursive: true, force: true });
  }
});

// --- env allowlist builder ---------------------------------------------------

test("buildSpawnEnv drops arbitrary user env and preserves required keys", () => {
  const sourceEnv = {
    PATH: "/usr/bin:/bin",
    HOME: "/home/u",
    LANG: "en_US.UTF-8",
    TERM: "xterm",
    // Arbitrary user env that must be dropped (e.g. plugin/config toggles).
    CODEX_PLUGIN_DIR: "/home/u/.codex/plugins",
    NODE_OPTIONS: "--inspect",
    SECRET_TOKEN: "nope",
    npm_config_x: "y",
  };
  const env = buildSpawnEnv({ sourceEnv, codexHome: "/tmp/iso-home", authMode: "chatgpt_codex", homeDir: "/home/u" });
  assert.equal(env.PATH, "/usr/bin:/bin");
  assert.equal(env.CODEX_HOME, "/tmp/iso-home");
  assert.equal(env.HOME, "/home/u");
  assert.equal(env.LANG, "en_US.UTF-8");
  assert.equal(env.TERM, "xterm");
  // Arbitrary user env is gone.
  for (const dropped of ["CODEX_PLUGIN_DIR", "NODE_OPTIONS", "SECRET_TOKEN", "npm_config_x"]) {
    assert.equal(Object.hasOwn(env, dropped), false, `${dropped} must be dropped from the allowlist env`);
  }
});

test("buildSpawnEnv enforces the auth-mode contract for API-key env", () => {
  const sourceEnv = {
    PATH: "/usr/bin:/bin",
    HOME: "/home/u",
    CODEX_API_KEY: "ck-123",
    OPENAI_API_KEY: "ok-456",
  };
  // Subscription mode: API-key env must NOT be forwarded.
  const subscription = buildSpawnEnv({ sourceEnv, codexHome: "/tmp/iso", authMode: "chatgpt_codex", homeDir: "/home/u" });
  assert.equal(Object.hasOwn(subscription, "CODEX_API_KEY"), false);
  assert.equal(Object.hasOwn(subscription, "OPENAI_API_KEY"), false);
  // api-key mode: forward whichever API key envs are present.
  const apiKey = buildSpawnEnv({ sourceEnv, codexHome: "/tmp/iso", authMode: "api-key", homeDir: "/home/u" });
  assert.equal(apiKey.CODEX_API_KEY, "ck-123");
  assert.equal(apiKey.OPENAI_API_KEY, "ok-456");
});

test("buildSpawnEnv requires PATH (fails loudly rather than crippling the child)", () => {
  assert.throws(
    () => buildSpawnEnv({ sourceEnv: { HOME: "/home/u" }, codexHome: "/tmp/iso", authMode: "chatgpt_codex", homeDir: "/home/u" }),
    /requires PATH/,
  );
});

// --- post-run fixture validator ----------------------------------------------

test("RUNTIME_STATE_BASENAMES includes at minimum .omx and .omc", () => {
  assert(RUNTIME_STATE_BASENAMES.includes(".omx"));
  assert(RUNTIME_STATE_BASENAMES.includes(".omc"));
});

test("validateFixtureAfterRun passes when the fixture is unchanged and clean", () => {
  const fixture = makeTmpDir("herm-clean-");
  try {
    writeFile(path.join(fixture, "wiki", "startup.md"), "# Startup\n");
    writeFile(path.join(fixture, "README.md"), "# Fixture\n");
    const expectedFingerprint = fingerprintDirectory(fixture);
    const result = validateFixtureAfterRun({ cwd: fixture, expectedFingerprint });
    assert.equal(result.status, "clean");
    assert.deepEqual(result.runtime_state_paths, []);
    assert.equal(result.fingerprint_matched, true);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("validateFixtureAfterRun fails when a tracked file is mutated", () => {
  const fixture = makeTmpDir("herm-mutate-");
  try {
    writeFile(path.join(fixture, "README.md"), "# Fixture\n");
    const expectedFingerprint = fingerprintDirectory(fixture);
    // Mutate a file after capturing the expected fingerprint.
    writeFile(path.join(fixture, "README.md"), "# Fixture mutated\n");
    assert.throws(
      () => validateFixtureAfterRun({ cwd: fixture, expectedFingerprint }),
      (error) => error.message.includes("changed during the measured run"),
    );
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("validateFixtureAfterRun HARD-FAILS on a planted .omx/state/x runtime-state path, naming it", () => {
  const fixture = makeTmpDir("herm-omx-");
  try {
    writeFile(path.join(fixture, "README.md"), "# Fixture\n");
    const expectedFingerprint = fingerprintDirectory(fixture);
    // Snapshot BEFORE planting the runtime-state file (empty of denylist paths).
    const preRunSnapshot = snapshotFixturePaths(fixture);
    // Plant the exact runtime-state file the 2026-06-10 run leaked into fixtures.
    writeFile(path.join(fixture, ".omx", "state", "x"), "session-state");
    assert.throws(
      () => validateFixtureAfterRun({ cwd: fixture, expectedFingerprint, preRunSnapshot }),
      (error) => error.message.includes("runtime-state paths present") && error.message.includes(".omx"),
    );
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("findRuntimeStatePaths reports nested runtime-state dirs and is empty on a clean tree", () => {
  const fixture = makeTmpDir("herm-find-");
  try {
    writeFile(path.join(fixture, "packages", "a", "src", "index.ts"), "export const a = 1;\n");
    assert.deepEqual(findRuntimeStatePaths(fixture), []);
    writeFile(path.join(fixture, ".omc", "notepad.md"), "notes");
    writeFile(path.join(fixture, "packages", "a", ".omx", "state.json"), "{}");
    const found = findRuntimeStatePaths(fixture);
    assert(found.includes(".omc"), `expected .omc, got ${JSON.stringify(found)}`);
    assert(found.includes("packages/a/.omx"), `expected nested .omx, got ${JSON.stringify(found)}`);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

// --- snapshot-based denylist tests (pre-run snapshot distinguishes bootstrap from runtime state) ---

test("validateFixtureAfterRun PASSES when bootstrap dot-dirs pre-exist and fixture is unchanged", () => {
  // Simulates a realistic with_project_librarian fixture: .claude/, .codex/,
  // .cursor/, .gemini/ are created by the Project Librarian bootstrap BEFORE the
  // run. They must not trigger the denylist when a pre-run snapshot is provided.
  const fixture = makeTmpDir("herm-bootstrap-pass-");
  try {
    writeFile(path.join(fixture, "README.md"), "# Fixture\n");
    writeFile(path.join(fixture, ".claude", "settings.json"), "{}");
    writeFile(path.join(fixture, ".codex", "hooks.json"), "{}");
    writeFile(path.join(fixture, ".cursor", "rules", "main.md"), "rules");
    writeFile(path.join(fixture, ".gemini", "settings.yaml"), "key: val");
    // Fingerprint and snapshot with bootstrap dirs already in place.
    const expectedFingerprint = fingerprintDirectory(fixture);
    const preRunSnapshot = snapshotFixturePaths(fixture);
    // No changes after snapshot — simulates a read-only codex run.
    const result = validateFixtureAfterRun({ cwd: fixture, expectedFingerprint, preRunSnapshot });
    assert.equal(result.status, "clean");
    assert.deepEqual(result.runtime_state_paths, []);
    assert.equal(result.fingerprint_matched, true);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("validateFixtureAfterRun HARD-FAILS when .omx appears AFTER the snapshot (new runtime state)", () => {
  // Pre-existing bootstrap dirs are in snapshot; .omx arrives during the run.
  const fixture = makeTmpDir("herm-newomx-");
  try {
    writeFile(path.join(fixture, "README.md"), "# Fixture\n");
    writeFile(path.join(fixture, ".claude", "settings.json"), "{}");
    writeFile(path.join(fixture, ".codex", "hooks.json"), "{}");
    const expectedFingerprint = fingerprintDirectory(fixture);
    const preRunSnapshot = snapshotFixturePaths(fixture);
    // Simulate codex writing .omx/state/x during the run.
    writeFile(path.join(fixture, ".omx", "state", "x"), "session-state");
    assert.throws(
      () => validateFixtureAfterRun({ cwd: fixture, expectedFingerprint, preRunSnapshot }),
      (error) => error.message.includes("runtime-state paths present") && error.message.includes(".omx"),
    );
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("validateFixtureAfterRun HARD-FAILS when a new file appears under a pre-existing .codex/ (fingerprint drift)", () => {
  // A new file under an already-snapshotted .codex/ is caught by the fingerprint
  // check (content changes). The error must indicate fixture drift, not a false
  // negative — the fingerprint check is the backstop even when the denylist path
  // (.codex) was pre-existing.
  const fixture = makeTmpDir("herm-codex-drift-");
  try {
    writeFile(path.join(fixture, "README.md"), "# Fixture\n");
    writeFile(path.join(fixture, ".codex", "hooks.json"), "{}");
    const expectedFingerprint = fingerprintDirectory(fixture);
    const preRunSnapshot = snapshotFixturePaths(fixture);
    // Codex writes a new state file under the pre-existing .codex/ dir.
    writeFile(path.join(fixture, ".codex", "history.sqlite"), "binary-state");
    assert.throws(
      () => validateFixtureAfterRun({ cwd: fixture, expectedFingerprint, preRunSnapshot }),
      (error) => error.message.includes("changed during the measured run"),
    );
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("checkPreRunFingerprint passes on an unmodified fixture and fails on a stale one", () => {
  const fixture = makeTmpDir("herm-prerun-");
  try {
    writeFile(path.join(fixture, "wiki", "startup.md"), "# Startup\n");
    writeFile(path.join(fixture, "README.md"), "# Fixture\n");
    const expectedFingerprint = fingerprintDirectory(fixture);
    // Passes on an unmodified fixture.
    checkPreRunFingerprint({ cwd: fixture, expectedFingerprint });
    // Mutate the fixture (simulate stale state from a previous run).
    writeFile(path.join(fixture, "README.md"), "# Fixture (stale)\n");
    assert.throws(
      () => checkPreRunFingerprint({ cwd: fixture, expectedFingerprint }),
      (error) => error.message.includes("pre-run fixture check FAILED") && error.message.includes("stale or mutated"),
    );
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

// --- integration-style: stub the codex spawn with a fake tmp executable ------

// This proves the hermetic env reaches the child and that a clean child run
// passes post-run validation. The fake "codex" is a node script created inside
// tmp and invoked by absolute path; it is NEVER placed on PATH as "codex".
test("a stubbed codex child runs under the isolated env and leaves the fixture clean", () => {
  const work = makeTmpDir("herm-integ-");
  try {
    const realHome = makeFakeCodexHome("herm-integ-real-");
    const destHome = path.join(work, "codex-home");
    const isolation = buildIsolatedCodexHome({ realCodexHome: realHome, destHome });
    const spawnEnv = buildSpawnEnv({ sourceEnv: process.env, codexHome: destHome, authMode: "chatgpt_codex", homeDir: os.homedir() });

    // Fake codex: emit a turn.completed JSONL line to stdout and write its own
    // CODEX_HOME into stderr so we can assert the isolated home reached the child.
    const fakeCodex = path.join(work, "fake-codex.js");
    writeFile(fakeCodex, [
      "#!/usr/bin/env node",
      "'use strict';",
      "process.stderr.write('CODEX_HOME=' + (process.env.CODEX_HOME || '') + '\\n');",
      "process.stdout.write(JSON.stringify({ type: 'turn.completed', model: 'gpt-5.5', usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 }, message: 'done' }) + '\\n');",
      "",
    ].join("\n"));

    // The measured fixture: capture its fingerprint, then run the fake child in
    // it. A read-only child must not change the fixture.
    const fixture = path.join(work, "fixture");
    writeFile(path.join(fixture, "README.md"), "# Fixture\n");
    const expectedFingerprint = fingerprintDirectory(fixture);
    // Pre-run integrity check must pass on an unmodified fixture.
    checkPreRunFingerprint({ cwd: fixture, expectedFingerprint });
    const preRunSnapshot = snapshotFixturePaths(fixture);

    const result = childProcess.spawnSync(process.execPath, [fakeCodex, "exec"], {
      cwd: fixture,
      env: spawnEnv,
      encoding: "utf8",
    });
    assert.equal(result.status, 0);
    assert(result.stderr.includes(`CODEX_HOME=${destHome}`), `child should see the isolated CODEX_HOME, stderr: ${result.stderr}`);
    assert(result.stdout.includes("turn.completed"));
    // No inherited process.env: the child env has no npm_* injected keys.
    assert.equal(Object.keys(spawnEnv).some((key) => key.startsWith("npm_")), false);
    assert.equal(isolation.copied_files.length, 1);

    const validation = validateFixtureAfterRun({ cwd: fixture, expectedFingerprint, preRunSnapshot });
    assert.equal(validation.status, "clean");

    fs.rmSync(realHome, { recursive: true, force: true });
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
});
