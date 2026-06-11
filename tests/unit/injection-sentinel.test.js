"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { SENTINEL_PROMPT, judgeSentinelTranscript } = require("../../benchmarks/tools/injection-sentinel.js");

const SENTINEL = "SENTINEL-1781000000000-abcd1234";

function jsonl(lines) {
  return lines.map((line) => JSON.stringify(line)).join("\n");
}

test("the sentinel prompt asks to echo a SENTINEL- line or answer NO-INJECTION", () => {
  assert(SENTINEL_PROMPT.includes("SENTINEL-"));
  assert(SENTINEL_PROMPT.includes("NO-INJECTION"));
});

test("injected: sentinel echoed before any command -> injected", () => {
  const content = jsonl([
    { type: "assistant.message", message: `Here it is: ${SENTINEL}` },
    { type: "turn.completed", usage: { input_tokens: 12, output_tokens: 4 } },
  ]);
  const result = judgeSentinelTranscript(content, SENTINEL);
  assert.equal(result.verdict, "injected");
  assert.equal(result.evidence.command_event_count, 0);
  assert.equal(result.evidence.read_boundary_index, -1);
  assert.equal(result.evidence.sentinel_echo_index, 0);
});

test("read-then-echo: a file-read command precedes the echo -> not-injected", () => {
  const content = jsonl([
    { type: "tool.command.completed", command: "cat wiki/startup.md", exit_code: 0 },
    { type: "assistant.message", message: `After reading: ${SENTINEL}` },
    { type: "turn.completed", usage: { input_tokens: 30, output_tokens: 6 } },
  ]);
  const result = judgeSentinelTranscript(content, SENTINEL);
  assert.equal(result.verdict, "not-injected");
  assert.equal(result.evidence.file_read_command_count, 1);
  assert.equal(result.evidence.first_file_read_index, 0);
  assert(result.evidence.sentinel_echo_index > result.evidence.read_boundary_index);
});

test("no-injection: model answers NO-INJECTION with no sentinel -> not-injected", () => {
  const content = jsonl([
    { type: "tool.command.completed", command: "cat wiki/startup.md", exit_code: 0 },
    { type: "assistant.message", message: "NO-INJECTION" },
  ]);
  const result = judgeSentinelTranscript(content, SENTINEL);
  assert.equal(result.verdict, "not-injected");
  assert.equal(result.evidence.saw_no_injection_answer, true);
  assert.equal(result.evidence.sentinel_echo_index, -1);
});

test("no-injection answer with no command at all is still not-injected", () => {
  const content = jsonl([
    { type: "assistant.message", message: "NO-INJECTION" },
  ]);
  const result = judgeSentinelTranscript(content, SENTINEL);
  assert.equal(result.verdict, "not-injected");
});

test("inconclusive: neither a sentinel echo nor a NO-INJECTION answer", () => {
  const content = jsonl([
    { type: "tool.command.completed", command: "ls -la", exit_code: 0 },
    { type: "assistant.message", message: "I was unable to determine anything useful." },
  ]);
  const result = judgeSentinelTranscript(content, SENTINEL);
  assert.equal(result.verdict, "inconclusive");
});

test("a non-read command before the echo still counts as a tool turn -> not-injected", () => {
  // A generic command (not obviously a file read) still proves the model took a
  // tool turn before answering, so the echo is not attributable to injection.
  const content = jsonl([
    { type: "tool.command.completed", command: "true", exit_code: 0 },
    { type: "assistant.message", message: `Echo: ${SENTINEL}` },
  ]);
  const result = judgeSentinelTranscript(content, SENTINEL);
  assert.equal(result.verdict, "not-injected");
  assert.equal(result.evidence.command_event_count, 1);
  assert.equal(result.evidence.file_read_command_count, 0);
  assert.equal(result.evidence.read_boundary_index, 0);
});

test("the judge rejects a malformed sentinel token", () => {
  assert.throws(() => judgeSentinelTranscript("", "not-a-sentinel"), /sentinel must be a string starting with SENTINEL-/);
});

test("the judge surfaces malformed JSONL rather than guessing", () => {
  assert.throws(() => judgeSentinelTranscript("{not json}", SENTINEL), /invalid JSONL/);
});
