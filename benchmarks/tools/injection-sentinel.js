#!/usr/bin/env node
"use strict";

// B1 injection sentinel (script only; does NOT run codex by default).
//
// Question under test: does `codex exec` execute the bootstrap's
// `.codex/hooks.json` SessionStart hook and inject `wiki/startup.md` into the
// session context, or must the agent manually read the file? The benchmark's
// "free startup context" benefit depends on injection actually happening in
// non-interactive Codex.
//
// Method: bootstrap a tmp fixture (hooks configured), append a unique
// `SENTINEL-...` line to the fixture's `wiki/startup.md`, then ask Codex to
// repeat any line starting with `SENTINEL-` or answer `NO-INJECTION`. The JSONL
// is judged by judgeSentinelTranscript:
//   - sentinel echoed in an assistant message BEFORE any file-read command event
//     -> injection works (the model had the sentinel without reading the file).
//   - sentinel echoed only AFTER a file-read command, or the model answered
//     NO-INJECTION -> injection absent.
//   - anything else -> inconclusive.
//
// Without --allow-codex-run (default) this prints the exact procedure and exits
// 2 without fabricating a result. Real codex is never run by the default path
// and never by the unit test (which feeds crafted JSONL to the judge).

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");
const { classifyEvent, eventTimestampMs, parseJsonlLines } = require("../lib/codex-jsonl");

const SENTINEL_PROMPT =
  "If your session context contains a line starting with SENTINEL-, repeat that line exactly; otherwise answer NO-INJECTION.";

// A command event that reads a file. Under --sandbox read-only the only commands
// are reads, but we still require the command text to look like a file read (and
// optionally name the startup file) so a non-read command is not miscounted as a
// startup read. Returns { isCommand, isFileRead, text }.
function commandReadInfo(event) {
  const classification = classifyEvent(event);
  if (!classification.isCommand) return { isCommand: false, isFileRead: false, text: "" };
  const parts = [];
  for (const value of [event.command, event.cmd, event.item && event.item.command, event.call && event.call.command]) {
    if (typeof value === "string") parts.push(value);
    else if (Array.isArray(value)) parts.push(value.join(" "));
  }
  const text = parts.join(" ").toLowerCase();
  const readLike = /\b(cat|sed|head|tail|less|rg|grep|nl|awk|cut|read_file|view|open)\b/.test(text) || text.includes("startup.md");
  return { isCommand: true, isFileRead: readLike, text };
}

function assistantText(event) {
  const type = typeof event?.type === "string" ? event.type.toLowerCase() : "";
  const itemType = typeof event?.item?.type === "string" ? event.item.type.toLowerCase() : "";
  const isMessage = type.includes("assistant") || type.includes("message") || itemType.includes("message") || itemType.includes("agent_message");
  if (!isMessage) return "";
  for (const value of [event.message, event.item, event.response, event]) {
    if (typeof value === "string") return value;
    if (value && typeof value === "object") {
      if (typeof value.text === "string") return value.text;
      if (typeof value.content === "string") return value.content;
      if (typeof value.message === "string") return value.message;
      if (value.message && typeof value.message.text === "string") return value.message.text;
    }
  }
  return "";
}

// Judge an ordered Codex JSONL transcript for sentinel injection. Pure function:
// given the raw JSONL string and the unique sentinel line, returns a single
// verdict plus evidence counts. Ordering is by array position; when timestamps
// are present and monotonic they corroborate position but position is the
// authority because injected context precedes any tool call in the stream.
function judgeSentinelTranscript(jsonlContent, sentinel) {
  if (typeof sentinel !== "string" || !sentinel.startsWith("SENTINEL-")) {
    throw new Error("sentinel must be a string starting with SENTINEL-");
  }
  const events = parseJsonlLines(jsonlContent);

  let firstFileReadIndex = -1;
  let firstCommandIndex = -1;
  let commandEventCount = 0;
  let fileReadCommandCount = 0;
  let assistantMessageCount = 0;
  let sentinelEchoIndex = -1;
  let sawNoInjectionAnswer = false;

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    const read = commandReadInfo(event);
    if (read.isCommand) {
      commandEventCount += 1;
      if (firstCommandIndex === -1) firstCommandIndex = index;
    }
    if (read.isFileRead) {
      fileReadCommandCount += 1;
      if (firstFileReadIndex === -1) firstFileReadIndex = index;
    }
    const text = assistantText(event);
    if (text) {
      assistantMessageCount += 1;
      if (sentinelEchoIndex === -1 && text.includes(sentinel)) sentinelEchoIndex = index;
      if (text.includes("NO-INJECTION")) sawNoInjectionAnswer = true;
    }
  }

  // The read boundary is the first file-read command if one exists, otherwise the
  // first command event of any kind (a non-read command still proves the model
  // took a tool turn before answering).
  const readBoundaryIndex = firstFileReadIndex !== -1 ? firstFileReadIndex : firstCommandIndex;

  let verdict;
  let reason;
  if (sentinelEchoIndex !== -1) {
    if (readBoundaryIndex === -1 || sentinelEchoIndex < readBoundaryIndex) {
      verdict = "injected";
      reason = "sentinel echoed in an assistant message with no preceding file-read command";
    } else {
      verdict = "not-injected";
      reason = "sentinel echoed only after a file-read command";
    }
  } else if (sawNoInjectionAnswer) {
    verdict = "not-injected";
    reason = "model answered NO-INJECTION; sentinel was not in context";
  } else {
    verdict = "inconclusive";
    reason = "no sentinel echo and no NO-INJECTION answer in any assistant message";
  }

  const timestamps = events.map(eventTimestampMs).filter(Number.isFinite);
  return {
    verdict,
    reason,
    evidence: {
      event_count: events.length,
      assistant_message_count: assistantMessageCount,
      command_event_count: commandEventCount,
      file_read_command_count: fileReadCommandCount,
      first_command_index: firstCommandIndex,
      first_file_read_index: firstFileReadIndex,
      read_boundary_index: readBoundaryIndex,
      sentinel_echo_index: sentinelEchoIndex,
      saw_no_injection_answer: sawNoInjectionAnswer,
      timestamp_count: timestamps.length,
    },
  };
}

function uniqueSentinel() {
  // The sentinel must be unique per run so an echo cannot be a coincidental
  // match. Randomness here only names a one-shot probe token; it never enters
  // fixture content used by the deterministic benchmark manifest.
  return `SENTINEL-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function buildSentinelFixture(cliPath) {
  if (!cliPath || !fs.existsSync(cliPath)) {
    throw new Error("missing Project Librarian CLI; run npm run build before the injection sentinel");
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "project-librarian-injection-sentinel-"));
  childProcess.execFileSync(process.execPath, [cliPath, "--no-git-config"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const startupPath = path.join(root, "wiki", "startup.md");
  if (!fs.existsSync(startupPath)) {
    throw new Error(`bootstrap did not produce ${startupPath}`);
  }
  const hooksPath = path.join(root, ".codex", "hooks.json");
  if (!fs.existsSync(hooksPath)) {
    throw new Error(`bootstrap did not configure the Codex SessionStart hook at ${hooksPath}`);
  }
  const sentinel = uniqueSentinel();
  fs.appendFileSync(startupPath, `\n${sentinel}\n`);
  return { root, sentinel, startupPath, hooksPath };
}

function sentinelCommand() {
  return ["codex", "exec", "--json", "--ephemeral", "--sandbox", "read-only", "--skip-git-repo-check", SENTINEL_PROMPT];
}

function printProcedure(cliRelative) {
  const command = sentinelCommand();
  const lines = [
    "sentinel not run: pass --allow-codex-run",
    "",
    "Procedure (consumes a small amount of Codex/ChatGPT quota when run):",
    `1. Build the CLI: npm run build (expects ${cliRelative}).`,
    "2. Bootstrap a tmp fixture with --no-git-config so .codex/hooks.json SessionStart is configured.",
    "3. Append a unique line 'SENTINEL-<unique>' to the fixture's wiki/startup.md.",
    `4. From the fixture root run: ${command.map((part) => (part === SENTINEL_PROMPT ? JSON.stringify(part) : part)).join(" ")}`,
    "5. Judge the JSONL with judgeSentinelTranscript:",
    "   - sentinel echoed before any file-read command -> injected",
    "   - sentinel echoed only after a file-read command, or NO-INJECTION -> not-injected",
    "   - otherwise -> inconclusive",
    "Raw JSONL is written under a tmp output dir, never under benchmarks/reports/.",
  ];
  process.stderr.write(`${lines.join("\n")}\n`);
}

function runSentinel({ cliPath, requestedModel }) {
  const { root, sentinel, startupPath } = buildSentinelFixture(cliPath);
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "project-librarian-injection-sentinel-out-"));
  const rawPath = path.join(outputDir, "sentinel.jsonl");
  const stderrPath = path.join(outputDir, "sentinel.stderr.txt");

  const command = sentinelCommand();
  if (requestedModel) command.splice(command.length - 1, 0, "--model", requestedModel);
  const result = childProcess.spawnSync(command[0], command.slice(1), {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  fs.writeFileSync(rawPath, result.stdout || "");
  if (result.stderr) fs.writeFileSync(stderrPath, result.stderr);

  if (result.error) {
    throw new Error(`codex failed to launch: ${result.error.message}`);
  }
  const judged = judgeSentinelTranscript(result.stdout || "", sentinel);
  const summary = {
    status: "ok",
    verdict: judged.verdict,
    reason: judged.reason,
    sentinel,
    fixture_root: root,
    startup_path: startupPath,
    raw_jsonl_path: rawPath,
    stderr_path: result.stderr ? stderrPath : null,
    exit_code: result.status,
    evidence: judged.evidence,
  };
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  return judged.verdict;
}

function main() {
  const argv = process.argv.slice(2);
  const allowCodexRun = argv.includes("--allow-codex-run");
  const modelIndex = argv.indexOf("--model");
  const requestedModel = modelIndex >= 0 && argv[modelIndex + 1] && !argv[modelIndex + 1].startsWith("--") ? argv[modelIndex + 1] : "";
  const cliPath = path.resolve(__dirname, "..", "..", "dist", "init-project-wiki.js");
  const cliRelative = path.relative(path.resolve(__dirname, "..", ".."), cliPath).split(path.sep).join("/");

  if (!allowCodexRun) {
    printProcedure(cliRelative);
    process.exit(2);
  }
  runSentinel({ cliPath, requestedModel });
}

if (require.main === module) {
  main();
}

module.exports = {
  SENTINEL_PROMPT,
  judgeSentinelTranscript,
};
