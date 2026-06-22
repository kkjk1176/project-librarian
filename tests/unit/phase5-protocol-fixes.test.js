"use strict";

// Phase 5 (benchmark validity): B1 startup-TL;DR sync into the managed AGENTS.md
// block, B2 doctor router-truth contradiction rule, B3 injected-context hook
// marker, and B4 wiki trust-contract sentence. All writing CLI runs use tmp dirs
// (never this repo root); the repo-root B2 exit gate is checked read-only.

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const cliPath = path.resolve(__dirname, "..", "..", "dist", "init-project-wiki.js");
const distTemplates = require("../../dist/templates.js");
const {
  SEEDED_DECISION,
  maintainedRecentDecisions,
  maintainedStartup,
} = require("../../benchmarks/lib/llm-fixtures");

// Hook budgets from src/hooks.ts. The B3 marker is preamble overhead, not file
// content, so the per-file budgets must stay exactly these.
const STARTUP_BUDGET = 3500;
const INDEX_BUDGET = 4500;

const TLDR_SYNC_LABEL = "Startup TL;DR (auto-synced for non-interactive sessions; source: wiki/startup.md)";
const TRUST_CONTRACT_LEAD = "Wiki decision documents are authoritative for project decisions";
const FIRST_TEMPLATE_TLDR_BULLET = "This project is in an initial planning state unless the canonical wiki says otherwise.";

function makeTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runCli(cwd, args = []) {
  return childProcess.execFileSync(process.execPath, [cliPath, "--no-git-config", ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

// Run the CLI capturing exit status and stderr so hard-fail cases can be asserted.
function runCliResult(cwd, args = []) {
  return childProcess.spawnSync(process.execPath, [cliPath, "--no-git-config", ...args], {
    cwd,
    encoding: "utf8",
  });
}

function readFile(root, relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function managedAgentsBlock(root) {
  const text = readFile(root, "AGENTS.md");
  const start = text.indexOf("<!-- PROJECT-WIKI-FIRST:START -->");
  const end = text.indexOf("<!-- PROJECT-WIKI-FIRST:END -->");
  assert(start >= 0 && end > start, "AGENTS.md is missing the managed marker block");
  return text.slice(start, end);
}

// ---------------------------------------------------------------------------
// extractStartupTldr unit behavior (B1 source extraction)
// ---------------------------------------------------------------------------

test("extractStartupTldr returns only the TL;DR bullets from the startup template", () => {
  const tldr = distTemplates.extractStartupTldr(distTemplates.startup);
  assert(tldr.includes(FIRST_TEMPLATE_TLDR_BULLET), "missing first template TL;DR bullet");
  assert(tldr.split(/\r?\n/).every((line) => /^\s*-\s+\S/.test(line)), "every synced line should be a bullet");
  // TL;DR section ONLY: never Recent Decisions or Project State content.
  assert(!tldr.includes("Recent Project Decisions"), "TL;DR sync must not include Recent Decisions");
  assert(!tldr.includes("Read On Demand"), "TL;DR sync must stop at the next heading");
});

test("extractStartupTldr throws loudly when the TL;DR section is missing", () => {
  assert.throws(
    () => distTemplates.extractStartupTldr("# Startup Context\n\n## Overview\n\n- not a tldr\n"),
    (error) => error.message.includes("no \"## TL;DR\" section"),
  );
});

test("extractStartupTldr throws loudly when the TL;DR section has no bullets", () => {
  assert.throws(
    () => distTemplates.extractStartupTldr("# Startup Context\n\n## TL;DR\n\nProse only, no bullets.\n\n## Next\n"),
    (error) => error.message.includes("no bullet items"),
  );
});

// ---------------------------------------------------------------------------
// B1: AGENTS.md startup-TL;DR sync (fresh bootstrap, re-sync, idempotency, fail)
// ---------------------------------------------------------------------------

test("fresh bootstrap syncs the template TL;DR into the managed AGENTS.md block", () => {
  const root = makeTmpDir("p5-sync-fresh-");
  try {
    runCli(root);
    const block = managedAgentsBlock(root);
    assert(block.includes(TLDR_SYNC_LABEL), "missing the labeled auto-synced sub-block");
    assert(block.includes(FIRST_TEMPLATE_TLDR_BULLET), "synced TL;DR bullet not embedded");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("changed startup TL;DR re-syncs into AGENTS.md on the next run", () => {
  const root = makeTmpDir("p5-sync-change-");
  try {
    runCli(root);
    const startupPath = path.join(root, "wiki", "startup.md");
    const changed = fs.readFileSync(startupPath, "utf8").replace(
      FIRST_TEMPLATE_TLDR_BULLET,
      "CUSTOM-TLDR-FACT: this maintained startup fact must reach AGENTS.md.",
    );
    fs.writeFileSync(startupPath, changed);
    runCli(root);
    const block = managedAgentsBlock(root);
    assert(block.includes("CUSTOM-TLDR-FACT: this maintained startup fact must reach AGENTS.md."), "changed TL;DR did not re-sync");
    assert(!block.includes(FIRST_TEMPLATE_TLDR_BULLET), "stale TL;DR bullet still present after re-sync");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("--refresh-index leaves the AGENTS.md startup TL;DR sync untouched", () => {
  const root = makeTmpDir("p5-sync-refresh-");
  try {
    runCli(root);
    const agentsBefore = readFile(root, "AGENTS.md");
    const startupPath = path.join(root, "wiki", "startup.md");
    fs.writeFileSync(startupPath, fs.readFileSync(startupPath, "utf8").replace(
      FIRST_TEMPLATE_TLDR_BULLET,
      "REFRESH-TLDR-FACT: refresh-index must not sync this into AGENTS.md.",
    ));
    runCli(root, ["--refresh-index"]);
    assert.equal(readFile(root, "AGENTS.md"), agentsBefore, "refresh-index must not touch AGENTS.md");
    assert(!managedAgentsBlock(root).includes("REFRESH-TLDR-FACT"), "refresh-index unexpectedly re-synced the TL;DR");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("re-bootstrap with unchanged startup is idempotent for AGENTS.md", () => {
  const root = makeTmpDir("p5-sync-idem-");
  try {
    runCli(root);
    const before = readFile(root, "AGENTS.md");
    const rerun = runCli(root);
    assert.equal(readFile(root, "AGENTS.md"), before, "AGENTS.md changed on an unchanged re-run");
    assert.match(rerun, /exists\s+AGENTS\.md/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a startup.md missing its TL;DR section fails the sync loudly (no fallback)", () => {
  const root = makeTmpDir("p5-sync-fail-");
  try {
    runCli(root);
    const startupPath = path.join(root, "wiki", "startup.md");
    fs.writeFileSync(startupPath, fs.readFileSync(startupPath, "utf8").replace("## TL;DR", "## Overview"));
    const result = runCliResult(root);
    assert.notEqual(result.status, 0, "expected a nonzero exit on missing TL;DR");
    assert.match(result.stderr, /no "## TL;DR" section/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the TL;DR sync only rewrites the managed block; user content outside markers is preserved", () => {
  const root = makeTmpDir("p5-sync-preserve-");
  try {
    fs.writeFileSync(path.join(root, "AGENTS.md"), [
      "# House Rules",
      "",
      "USER-PREAMBLE: keep this line above the managed block.",
      "",
      "<!-- PROJECT-WIKI-FIRST:START -->",
      "old managed content",
      "<!-- PROJECT-WIKI-FIRST:END -->",
      "",
      "USER-EPILOGUE: keep this line below the managed block.",
      "",
    ].join("\n"));
    runCli(root);
    const text = readFile(root, "AGENTS.md");
    assert(text.includes("USER-PREAMBLE: keep this line above the managed block."), "preamble lost");
    assert(text.includes("USER-EPILOGUE: keep this line below the managed block."), "epilogue lost");
    assert(text.includes(TLDR_SYNC_LABEL), "managed block not refreshed with the TL;DR sync");
    assert(!text.includes("old managed content"), "stale managed content survived");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// B4: trust-contract sentence in the managed AGENTS.md block
// ---------------------------------------------------------------------------

test("the managed AGENTS.md block carries the single-sentence wiki trust contract", () => {
  const root = makeTmpDir("p5-trust-");
  try {
    runCli(root);
    const block = managedAgentsBlock(root);
    assert(block.includes(distTemplates.wikiTrustContract), "trust-contract sentence missing");
    assert(block.includes(TRUST_CONTRACT_LEAD), "trust-contract lead phrase missing");
    assert(block.includes("--doctor` router-truth rule"), "trust contract must name the --doctor router-truth guard");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// B3: SessionStart hook injected-context marker, within file budgets
// ---------------------------------------------------------------------------

test("every agent SessionStart hook payload carries the injected-context marker", () => {
  const root = makeTmpDir("p5-hookmarker-");
  try {
    runCli(root);
    const hooks = [
      ".codex/hooks/wiki-session-start.js",
      ".claude/hooks/wiki-session-start.js",
      ".cursor/hooks/wiki-session-start.js",
      ".gemini/hooks/wiki-session-start.js",
    ];
    for (const hook of hooks) {
      const env = { ...process.env, GEMINI_PROJECT_DIR: root };
      const out = childProcess.execFileSync(process.execPath, [path.join(root, hook)], { cwd: root, encoding: "utf8", env });
      const payload = JSON.parse(out);
      const ctx = payload.hookSpecificOutput ? payload.hookSpecificOutput.additionalContext : payload.additional_context;
      assert(typeof ctx === "string" && ctx.length > 0, `${hook} produced no additional context`);
      assert(ctx.includes("ALREADY included"), `${hook} missing injected-context marker`);
      assert(ctx.includes("Do not re-read these two files this session"), `${hook} missing no-duplicate-read instruction`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("SessionStart hooks report missing wiki startup files instead of claiming they were included", () => {
  const root = makeTmpDir("p5-hookmissing-");
  try {
    runCli(root);
    fs.rmSync(path.join(root, "wiki"), { recursive: true, force: true });
    const hooks = [
      ".codex/hooks/wiki-session-start.js",
      ".claude/hooks/wiki-session-start.js",
      ".cursor/hooks/wiki-session-start.js",
      ".gemini/hooks/wiki-session-start.js",
    ];
    for (const hook of hooks) {
      const env = { ...process.env, GEMINI_PROJECT_DIR: root };
      const out = childProcess.execFileSync(process.execPath, [path.join(root, hook)], { cwd: root, encoding: "utf8", env });
      const payload = JSON.parse(out);
      const ctx = payload.hookSpecificOutput ? payload.hookSpecificOutput.additionalContext : payload.additional_context;
      assert(typeof ctx === "string" && ctx.length > 0, `${hook} produced no additional context`);
      assert(!ctx.includes("ALREADY included"), `${hook} claimed missing wiki files were included`);
      assert(!ctx.includes("Do not re-read these two files this session"), `${hook} emitted stale no-duplicate-read guidance`);
      assert(ctx.includes("not fully included"), `${hook} did not report incomplete startup context`);
      assert(ctx.includes("wiki/startup.md"), `${hook} did not name missing startup.md`);
      assert(ctx.includes("wiki/index.md"), `${hook} did not name missing index.md`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the B3 marker does not change the per-file startup/index hook budgets", () => {
  const root = makeTmpDir("p5-hookbudget-");
  try {
    runCli(root);
    const hook = readFile(root, ".codex/hooks/wiki-session-start.js");
    assert(hook.includes(`["wiki/startup.md", ${STARTUP_BUDGET}]`), "startup budget changed");
    assert(hook.includes(`["wiki/index.md", ${INDEX_BUDGET}]`), "index budget changed");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// B2: doctor router-truth contradiction rule (collector + end-to-end + A1)
// ---------------------------------------------------------------------------

function writeWiki(root, relative, content) {
  const filePath = path.join(root, relative);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

// collectRouterTruthDiagnostics reads files through the workspace `root`, which is
// frozen to process.cwd() when dist/ is first required, so the rule is exercised
// the way it actually runs: via a spawned `--doctor` in the fixture cwd. The
// router-truth diagnostics print under the "Project wiki router-truth check"
// header and gate the exit code, so stdout plus exit status fully cover the rule.
function doctorRun(root) {
  return runCliResult(root, ["--doctor"]);
}

test("--doctor router-truth rule is a no-op when the decision log has no dated entry", () => {
  const root = makeTmpDir("p5-b2-empty-");
  try {
    runCli(root);
    // A fresh bootstrap log says "No project decisions yet." (no date), and the
    // routers say "None yet." — but with no dated log entry there is no contradiction.
    const result = doctorRun(root);
    assert.equal(result.status, 0, `fresh bootstrap should pass --doctor; stdout: ${result.stdout}`);
    assert(result.stdout.includes("Project wiki router-truth check"), "router-truth check header missing");
    assert(!result.stdout.includes("router-truth-contradiction"), "no-op case unexpectedly flagged a contradiction");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("--doctor flags both routers when the log has a dated entry and they say None yet.", () => {
  const root = makeTmpDir("p5-b2-violate-");
  try {
    runCli(root);
    const logPath = path.join(root, "wiki", "decisions", "log.md");
    fs.writeFileSync(logPath, fs.readFileSync(logPath, "utf8").replace(
      "No project decisions yet.",
      "- 2026-06-10 | metrics | benchmark evidence adopted | canonical: [[canonical/x]]",
    ));
    const result = doctorRun(root);
    assert.notEqual(result.status, 0, "--doctor must fail on a router-truth contradiction");
    const contradictionLines = result.stdout.split(/\r?\n/).filter((line) => line.includes("router-truth-contradiction"));
    assert.equal(contradictionLines.length, 2, `expected two contradiction diagnostics; got: ${contradictionLines.join(" || ")}`);
    assert(contradictionLines.some((line) => line.includes("wiki/startup.md")), "startup.md not flagged");
    assert(contradictionLines.some((line) => line.includes("wiki/decisions/recent.md")), "recent.md not flagged");
    for (const line of contradictionLines) {
      assert(line.includes("error"), "router-truth diagnostics must be error-level");
      assert(line.includes("wiki/decisions/log.md holds a dated decision entry"), "message must name the log side");
      assert(line.includes("None yet."), "message must name the contradiction marker");
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("--doctor passes when maintained routers carry the dated decision (A1 fixture seeds)", () => {
  // The same maintained-wiki seeds the A1 benchmark fixtures use must satisfy the
  // shipped doctor rule (canonical Phase 5 exit gate). Bootstrap, then overwrite
  // the routers with the A1 maintained content and a matching dated log.
  const root = makeTmpDir("p5-b2-a1-");
  try {
    runCli(root);
    writeWiki(root, "wiki/decisions/log.md", `# Decision Log\n\n- ${SEEDED_DECISION.date} | ${SEEDED_DECISION.category} | ${SEEDED_DECISION.summary}.\n`);
    writeWiki(root, "wiki/startup.md", maintainedStartup());
    writeWiki(root, "wiki/decisions/recent.md", maintainedRecentDecisions());
    const result = doctorRun(root);
    assert(!result.stdout.includes("router-truth-contradiction"), `A1 maintained routers tripped the rule; stdout: ${result.stdout}`);
    assert(result.stdout.includes("Project wiki router-truth check"), "router-truth check header missing");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("--doctor fails on a planted router-truth contradiction and passes once fixed", () => {
  const root = makeTmpDir("p5-b2-doctor-");
  try {
    runCli(root);
    const clean = doctorRun(root);
    assert.equal(clean.status, 0, "fresh bootstrap should pass --doctor");
    // Plant the contradiction, confirm it fails.
    const logPath = path.join(root, "wiki", "decisions", "log.md");
    fs.writeFileSync(logPath, fs.readFileSync(logPath, "utf8").replace(
      "No project decisions yet.",
      "- 2026-06-10 | metrics | benchmark evidence adopted | canonical: [[canonical/project-brief]]",
    ));
    assert.notEqual(doctorRun(root).status, 0, "--doctor must fail on a router-truth contradiction");
    // Fix the routers by recording the decision; the rule passes again.
    writeWiki(root, "wiki/decisions/recent.md", maintainedRecentDecisions());
    writeWiki(root, "wiki/startup.md", maintainedStartup());
    const fixed = doctorRun(root);
    assert(!fixed.stdout.includes("router-truth-contradiction"), "rule still flags after the routers were updated");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// MAJOR fix: B2 section-anchored scan — no false-positive on unrelated sections
// ---------------------------------------------------------------------------

test('B2 no false-positive: "None yet." in an unrelated startup section + maintained Recent Decisions → NO flag', () => {
  // A healthy wiki where Recent Project Decisions is maintained but another section
  // (e.g. open-questions) legitimately says "None yet." must NOT be flagged.
  const root = makeTmpDir("p5-b2-falspos-startup-");
  try {
    runCli(root);
    // Plant a dated decision log entry so the rule is armed.
    const logPath = path.join(root, "wiki", "decisions", "log.md");
    fs.writeFileSync(logPath, fs.readFileSync(logPath, "utf8").replace(
      "No project decisions yet.",
      "- 2026-06-10 | metrics | benchmark evidence adopted | canonical: [[canonical/x]]",
    ));
    // Write a startup where Recent Project Decisions is maintained (has a dated
    // entry), but an unrelated section contains "None yet." text.
    writeWiki(root, "wiki/startup.md", maintainedStartup() + "\n## Open Questions\n\n- None yet.\n");
    writeWiki(root, "wiki/decisions/recent.md", maintainedRecentDecisions());
    const result = doctorRun(root);
    assert(
      !result.stdout.includes("router-truth-contradiction"),
      `false-positive: "None yet." in Open Questions triggered the rule; stdout: ${result.stdout}`,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('B2 no false-positive: "None yet." in an unrelated recent.md section → NO flag', () => {
  // Same check for decisions/recent.md: "None yet." outside the ## Decisions
  // section must not fire the rule.
  const root = makeTmpDir("p5-b2-falspos-recent-");
  try {
    runCli(root);
    const logPath = path.join(root, "wiki", "decisions", "log.md");
    fs.writeFileSync(logPath, fs.readFileSync(logPath, "utf8").replace(
      "No project decisions yet.",
      "- 2026-06-10 | metrics | benchmark evidence adopted | canonical: [[canonical/x]]",
    ));
    // Write recent.md with maintained ## Decisions but "None yet." in ## TL;DR.
    writeWiki(root, "wiki/decisions/recent.md",
      maintainedRecentDecisions().replace(
        "- Keep only recent important project decisions that may matter at session start.",
        "- Keep only recent important project decisions that may matter at session start.\n- Backlog items: None yet.",
      ),
    );
    writeWiki(root, "wiki/startup.md", maintainedStartup());
    const result = doctorRun(root);
    assert(
      !result.stdout.includes("router-truth-contradiction"),
      `false-positive: "None yet." outside ## Decisions triggered the rule; stdout: ${result.stdout}`,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("B2 real contradiction still flags after section-anchored fix", () => {
  // The real contradiction (template "None yet." in the relevant section while log
  // has a dated entry) must still be caught after the scope-anchoring change.
  const root = makeTmpDir("p5-b2-real-contra-");
  try {
    runCli(root);
    const logPath = path.join(root, "wiki", "decisions", "log.md");
    fs.writeFileSync(logPath, fs.readFileSync(logPath, "utf8").replace(
      "No project decisions yet.",
      "- 2026-06-10 | metrics | benchmark evidence adopted | canonical: [[canonical/x]]",
    ));
    // routers are at the template "None yet." state after fresh bootstrap
    const result = doctorRun(root);
    assert.notEqual(result.status, 0, "--doctor must still fail on the real contradiction");
    assert(result.stdout.includes("router-truth-contradiction"), "contradiction not flagged after scope-anchoring fix");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// MINOR 2: regex tolerates trailing whitespace / missing terminal period
// ---------------------------------------------------------------------------

test("B2 flags contradiction when the section contains 'None yet' without terminal period", () => {
  // Covers the whitespace/punctuation-tolerant regex (MINOR 2).
  const root = makeTmpDir("p5-b2-minor2-");
  try {
    runCli(root);
    const logPath = path.join(root, "wiki", "decisions", "log.md");
    fs.writeFileSync(logPath, fs.readFileSync(logPath, "utf8").replace(
      "No project decisions yet.",
      "- 2026-06-10 | metrics | benchmark evidence adopted | canonical: [[canonical/x]]",
    ));
    // Write startup with "None yet" (no period) in the Recent Project Decisions section.
    writeWiki(root, "wiki/startup.md",
      maintainedStartup().replace(
        `- ${SEEDED_DECISION.date}: ${SEEDED_DECISION.summary}.`,
        "- None yet",
      ),
    );
    const result = doctorRun(root);
    assert.notEqual(result.status, 0, "--doctor must flag 'None yet' (no period) as a contradiction");
    assert(result.stdout.includes("router-truth-contradiction"), "variant 'None yet' not caught by tolerant regex");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// MINOR 1: extractStartupTldr hard cap (no silent truncation)
// ---------------------------------------------------------------------------

test("extractStartupTldr throws loudly when extracted TL;DR exceeds the char cap", () => {
  const { extractStartupTldr, STARTUP_TLDR_MAX_CHARS } = distTemplates;
  // Build a startup with a TL;DR section that exceeds the cap via many bullets.
  const longBullet = "- " + "x".repeat(200);
  const manyBullets = Array.from({ length: 15 }, () => longBullet).join("\n");
  const input = `# Startup Context\n\n## TL;DR\n\n${manyBullets}\n\n## Next\n\nmore content\n`;
  assert.throws(
    () => extractStartupTldr(input),
    (error) => {
      assert(error.message.includes("exceeds the"), `unexpected message: ${error.message}`);
      assert(error.message.includes(String(STARTUP_TLDR_MAX_CHARS)), "message must state the cap");
      assert(error.message.includes("trim the ## TL;DR section"), "message must tell the author what to do");
      return true;
    },
  );
});

test("extractStartupTldr succeeds when extracted TL;DR is exactly at the cap", () => {
  const { extractStartupTldr, STARTUP_TLDR_MAX_CHARS } = distTemplates;
  // Build bullets totalling exactly STARTUP_TLDR_MAX_CHARS chars.
  // A single bullet: "- " + N chars. Join with "\n" (1 char per separator).
  // With k bullets each of length L, total = k*L + (k-1).
  // Use 1 bullet: length = STARTUP_TLDR_MAX_CHARS.
  const singleBullet = "- " + "x".repeat(STARTUP_TLDR_MAX_CHARS - 2);
  const input = `# Startup Context\n\n## TL;DR\n\n${singleBullet}\n\n## Next\n`;
  const result = extractStartupTldr(input);
  assert.equal(result.length, STARTUP_TLDR_MAX_CHARS, "exactly-at-cap should not throw");
});
