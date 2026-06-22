const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const cliPath = path.resolve(__dirname, "..", "..", "dist", "init-project-wiki.js");

function makeTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runCli(cwd, args = [], input = "") {
  return childProcess.execFileSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: "utf8",
    input,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function runCliResult(cwd, args = [], input = "") {
  return childProcess.spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: "utf8",
    input,
  });
}

function git(cwd, args) {
  childProcess.execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

test("handoff save/show/status/clear stores generated local state outside wiki", () => {
  const root = makeTmpDir("handoff-basic-");
  try {
    const payload = {
      goal: "Ship sk-test1234567890abcdef without leaking it",
      current_state: "Implementation started",
      blocked: ["none"],
      next_actions: ["Add tests", "Run build", "Update docs", "Do not include fourth"],
      recent_decisions: ["Startup hook pointer only"],
      open_questions: ["Benchmark full injection later?"],
      last_success_command: "npm run build",
      last_failure_command: "npm test",
      verification: ["unit test pending"],
    };

    const save = runCli(root, ["--handoff-save"], JSON.stringify(payload));
    assert.match(save, /Project Librarian handoff written: \.project-wiki\/session\/last-handoff\.md/);
    assert.equal(fs.existsSync(path.join(root, "wiki")), false, "handoff save must not create wiki files");

    const handoff = fs.readFileSync(path.join(root, ".project-wiki", "session", "last-handoff.md"), "utf8");
    assert.match(handoff, /PROJECT-LIBRARIAN-GENERATED: session-handoff\/v1/);
    assert.match(handoff, /Startup hook pointer only/);
    assert.match(handoff, /not a git repository/);
    assert.match(handoff, /- \[ \] Add tests/);
    assert.match(handoff, /- \[ \] Run build/);
    assert.match(handoff, /- \[ \] Update docs/);
    assert.doesNotMatch(handoff, /Do not include fourth/);
    assert.doesNotMatch(handoff, /sk-test1234567890abcdef/);
    assert.match(handoff, /\[REDACTED_OPENAI_KEY\]/);

    const show = runCli(root, ["--handoff-show"]);
    assert.match(show, /Project Librarian handoff: updated/);
    assert.match(show, /# Session Handoff/);

    const status = JSON.parse(runCli(root, ["--handoff-status"]));
    assert.equal(status.exists, true);
    assert.equal(status.safeToInject, true);
    assert.equal(status.path, ".project-wiki/session/last-handoff.md");

    const clear = runCli(root, ["--handoff-clear"]);
    assert.match(clear, /last-handoff\.md=removed/);
    assert.equal(fs.existsSync(path.join(root, ".project-wiki", "session", "last-handoff.md")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("handoff save rejects malformed JSON payload", () => {
  const root = makeTmpDir("handoff-malformed-json-");
  try {
    const result = runCliResult(root, ["--handoff-save"], "{bad json");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /invalid --handoff-save JSON payload/);
    assert.equal(fs.existsSync(path.join(root, ".project-wiki", "session", "last-handoff.md")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("handoff status marks stale state unsafe", () => {
  const root = makeTmpDir("handoff-stale-");
  try {
    runCli(root, ["--handoff-save", "--goal", "Old handoff"]);
    const statePath = path.join(root, ".project-wiki", "session", "handoff-state.json");
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    state.updated_at = "2020-01-01T00:00:00.000Z";
    fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);

    const status = JSON.parse(runCli(root, ["--handoff-status"]));
    assert.equal(status.exists, true);
    assert.equal(status.stale, true);
    assert.equal(status.safeToInject, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("handoff clear refuses non-generated handoff files", () => {
  const root = makeTmpDir("handoff-clear-safety-");
  try {
    fs.mkdirSync(path.join(root, ".project-wiki", "session"), { recursive: true });
    fs.writeFileSync(path.join(root, ".project-wiki", "session", "last-handoff.md"), "# User notes\n");
    const result = runCliResult(root, ["--handoff-clear"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /refusing to remove non-generated file/);
    assert.equal(fs.readFileSync(path.join(root, ".project-wiki", "session", "last-handoff.md"), "utf8"), "# User notes\n");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("handoff promotion appends selected facts to wiki inbox only", () => {
  const root = makeTmpDir("handoff-promote-");
  try {
    runCli(root);
    runCli(root, [
      "--handoff-save",
      "--goal",
      "Finish session handoff",
      "--state",
      "Promotion candidate is ready",
      "--next",
      "Review candidate",
      "--decision",
      "Promote only to inbox",
    ]);

    const promote = runCli(root, ["--handoff-promote-inbox"]);
    assert.match(promote, /promoted to wiki inbox/);
    const inbox = fs.readFileSync(path.join(root, "wiki", "inbox", "project-candidates.md"), "utf8");
    assert.match(inbox, /Session handoff: Finish session handoff/);
    assert.match(inbox, /session-handoff/);
    assert.match(inbox, /Promote only to inbox/);
    assert.equal(fs.existsSync(path.join(root, "wiki", "canonical", "session-handoff.md")), false);
    assert.match(fs.readFileSync(path.join(root, "wiki", "index.md"), "utf8"), /project-candidates/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("handoff injection opt-in status is generated and removable", () => {
  const root = makeTmpDir("handoff-injection-");
  try {
    runCli(root, ["--handoff-save", "--goal", "Injectable handoff"]);
    const before = JSON.parse(runCli(root, ["--handoff-injection-status"]));
    assert.equal(before.enabled, false);
    assert.equal(before.safeToInject, false);

    const enable = runCli(root, ["--handoff-injection-enable"]);
    assert.match(enable, /full injection enabled/);
    const enabled = JSON.parse(runCli(root, ["--handoff-injection-status"]));
    assert.equal(enabled.enabled, true);
    assert.equal(enabled.safeToInject, true);
    assert.equal(enabled.maxInjectedChars, 2500);

    const disable = runCli(root, ["--handoff-injection-disable"]);
    assert.match(disable, /injection-state\.json=removed/);
    const after = JSON.parse(runCli(root, ["--handoff-injection-status"]));
    assert.equal(after.enabled, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("handoff save refuses to overwrite symlinked target", () => {
  const root = makeTmpDir("handoff-symlink-");
  try {
    fs.mkdirSync(path.join(root, ".project-wiki", "session"), { recursive: true });
    const outside = path.join(root, "outside.txt");
    fs.writeFileSync(outside, "outside");
    fs.symlinkSync(outside, path.join(root, ".project-wiki", "session", "last-handoff.md"));

    const result = runCliResult(root, ["--handoff-save", "--goal", "Unsafe"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /refusing to write symlinked file/);
    assert.equal(fs.readFileSync(outside, "utf8"), "outside");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("handoff git facts do not execute diff.external", () => {
  const root = makeTmpDir("handoff-git-");
  try {
    git(root, ["init"]);
    git(root, ["config", "user.email", "test@example.com"]);
    git(root, ["config", "user.name", "Test User"]);
    fs.writeFileSync(path.join(root, "tracked.txt"), "one\n");
    git(root, ["add", "tracked.txt"]);
    git(root, ["commit", "-m", "initial"]);

    const marker = path.join(root, "diff-external-ran");
    const diffExternal = path.join(root, "diff-external.sh");
    fs.writeFileSync(diffExternal, `#!/bin/sh\necho ran > "${marker}"\nexit 0\n`);
    fs.chmodSync(diffExternal, 0o755);
    git(root, ["config", "diff.external", diffExternal]);
    fs.writeFileSync(path.join(root, "tracked.txt"), "two\n");

    const save = runCli(root, ["--handoff-save", "--goal", "Collect git facts"]);
    assert.match(save, /Project Librarian handoff written/);
    assert.equal(fs.existsSync(marker), false, "diff.external should not run");
    const handoff = fs.readFileSync(path.join(root, ".project-wiki", "session", "last-handoff.md"), "utf8");
    assert.match(handoff, /branch:/);
    assert.match(handoff, /status:/);
    assert.match(handoff, /diff stat:/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
